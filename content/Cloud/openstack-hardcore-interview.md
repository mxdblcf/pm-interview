# OpenStack 技术面试深度手册

> **适用场景**：高级云平台工程师 / 私有云架构师 / SRE 技术面试  
> **使用方法**：先通读方法论和"一句话定位"，再按模块深入，重点背熟第六章故障矩阵和第四章备份原理。

---

## 阅读指引与方法论

**核心目标**：这不是一份背诵清单，而是帮助你建立系统性认知框架的技术手册。面试官真正想听的，不是你能列出多少组件名，而是你能否清晰描述「**状态在谁手里、流量走哪条路径、故障如何收敛**」。

### 四个总纲

1. **架构本质**：OpenStack 是「控制面分布式系统 + 数据面多驱动系统」的组合。控制面关心状态一致、调度和 HA；数据面关心虚机性能、网络转发、存储时延和失败恢复。
2. **真实难点**：不是 API 数量多，而是 RabbitMQ、MariaDB、Keystone Fernet key 轮换、Neutron MTU、Placement 资源视图一致性与底层存储的综合联动。
3. **面试失分点**：给不出端到端链路描述；把快照当备份；分不清控制面故障和数据面故障；无法解释 `No valid host` 根因；把 Neutron 说成「就是建个网络」。
4. **私有云成败**：前期网络规划、故障域设计、自动化部署、备份恢复演练，远比「把服务跑起来」重要。

### 面试高分策略

| # | 策略 | 说明 |
|---|------|------|
| ① | 先给结论，再展开原理 | 不要一开口就列组件名 |
| ② | 用链路描述替代罗列 | 「一包流量怎么走」比「Neutron 有 ML2」更有说服力 |
| ③ | 主动提风险和坑 | 「这里经典问题是 MTU 没算 overlay 头」体现真实经验 |
| ④ | 说清楚边界 | OpenStack 负责什么、不负责什么，同样重要 |
| ⑤ | 结合规模和场景 | 百节点和千节点的架构选择是不同的 |

---

## 一、30 秒定位答法

### 基础层（30 秒）

> OpenStack 是一个 IaaS 云平台控制面，核心是 Keystone 做身份认证和服务目录，Nova 管计算生命周期，Neutron 管网络虚拟化，Cinder/Glance/Swift 分别管块存储、镜像和对象存储。通过 RabbitMQ 异步消息、MariaDB 持久化状态、Placement 维护资源视图，再经 OVS/OVN 和 Ceph 等底层组件把 API 请求变成真实的资源创建、调度、挂载和转发。

### 进阶层（追问时）

> OpenStack 的架构分两个平面：控制平面负责状态一致、调度决策、认证授权和 HA 协同；数据平面负责虚机运行、网络封装转发、块设备 IO 和存储复制。两者解耦的关键是消息总线和资源视图（Placement）。真正难运维的不是单个组件，而是多租户、overlay、存储一致性和控制面依赖之间的综合联动。

---

## 二、总体架构与核心原理

### 2.1 控制面 / 数据面分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  用户入口层                                                      │
│  User / CLI / SDK / Terraform                                   │
│       → HAProxy + Keepalived (VIP) → Horizon / REST API         │
├─────────────────────────────────────────────────────────────────┤
│  控制平面 Control Plane                                          │
│  Keystone │ Nova-API │ Neutron Server │ Cinder │ Glance         │
│  Placement │ Octavia │ Heat │ Barbican │ Ironic                 │
│  ──────────────────────────────────────────────────────────     │
│  RabbitMQ (AMQP) │ MariaDB/Galera │ Memcached │ Cells v2       │
├──────────────┬──────────────────────┬──────────────────────────┤
│ Compute Node │ Network Data Plane   │ Storage Backend          │
│ nova-compute │ OVS / OVN            │ Ceph RBD / FC / iSCSI   │
│ libvirt/QEMU │ VXLAN / GENEVE       │ NFS / LVM / Swift        │
│              │ SG / FIP / NAT / DVR │ Cinder-volume driver     │
└──────────────┴──────────────────────┴──────────────────────────┘
```

看这张图时始终抓住两个词：**状态**（主要在 DB、MQ、Placement、Keystone key、各服务资源映射里）和**流量**（走虚机、虚拟交换机、隧道、存储后端和外部网络）。

### 2.2 控制平面与数据平面为什么必须分离

| 维度 | 控制平面 | 数据平面 |
|------|----------|----------|
| 核心目标 | 状态一致、调度正确、认证授权 | 高吞吐、低时延、故障快速收敛 |
| 容错策略 | 支持重试、补偿、幂等写入 | 快速失败、本地自治、流量保持 |
| 扩展方式 | 水平扩展 API/Conductor/Scheduler | 横向增加 Compute/网络/存储节点 |
| 依赖关系 | 依赖 DB、MQ、Keystone | 依赖本地 libvirt、OVS、块设备映射 |
| 故障影响 | 控制面故障 → 新建操作失败，已运行 VM 不受影响 | 数据面故障 → 直接影响业务流量和 IO |

**面试标准答法**：控制面可以接受事务逻辑和重试带来的额外时延，但数据面更怕抖动、尾时延和丢包。两者混部时，高并发流量会抢占 CPU/内存/带宽，导致控制面响应变慢，进而引发 RabbitMQ 超时、数据库慢查询和调度误判。分离是为了让两者都能在各自最优的参数下工作。

### 2.3 虚机创建全链路（Boot Instance）

这是最高频考点，答法不是列步骤，而是**描述「每一步的边界责任和潜在失败点」**。

```
Client
  │
  ▼
nova-api ─── Keystone Token 校验 ─── 配额 / Flavor / 镜像 / AZ 参数校验
  │
  ▼
Placement API ── 查询 resource provider inventory / traits / aggregates
  │
  ▼
nova-scheduler ── FilterScheduler: 过滤 → 权重排序 → 选定目标 Host
  │
  ▼
nova-conductor ── 编排控制流，向目标 Cell 下发任务（避免 compute 直写 DB）
  │
  ├──► Neutron: 创建 Port → 绑定 (PortBinding) → 安全组规则下发
  │
  ├──► Glance: 获取镜像元数据 → nova-compute 拉取镜像到本地或后端
  │
  ├──► Cinder: 创建 / 映射 boot volume（若 boot-from-volume）
  │
  ▼
nova-compute
  ├──► Placement: 提交 Allocation
  ├──► libvirt: 生成 domain XML → qemu-kvm 启动虚机
  └──► 状态回写 DB: BUILDING → ACTIVE / ERROR
```

| 步骤 | 说明 |
|------|------|
| 认证 | Keystone 校验 Token，确认调用方身份和权限 |
| 参数校验 | Flavor、Image、Network、AZ、Server Group 策略合法性 |
| 资源查询 | Placement 返回满足条件的 Resource Provider 列表（含 traits、aggregates） |
| 调度选主 | FilterScheduler 执行过滤器链（RAM、CPU、磁盘、NUMA、PCI、亲和/反亲和），再按权重选出最优 Host |
| 端口准备 | Neutron 创建 Port，触发 ML2 机制驱动绑定，OVS/OVN 下发流表/ACL |
| 存储准备 | 镜像缓存或 boot volume attach，块设备映射到宿主机 |
| libvirt 启动 | 生成 domain XML（含 CPU pinning、hugepage、SR-IOV vf 等），qemu-kvm 运行 |
| 状态回写 | nova-compute 上报实例状态，Placement 确认 allocation，DB 更新 |

> **面试加分项 — 常见失败点**
> - 步骤 3：Placement inventory 视图陈旧或 reserved 配置过高 → `No valid host`
> - 步骤 4：host aggregate / AZ 约束把所有候选主机排空 → `Exhausted all hosts`
> - 步骤 5：ML2 agent down 或 physnet 映射错误 → `PortBindingFailed`
> - 步骤 6：Ceph 集群降级 / iSCSI session 断开 → volume attach 卡住
> - 步骤 7：CPU 型号不支持 / hugepage 未预留 / libvirt XML 非法 → 启动失败

---

## 三、核心组件深度解析

### 3.1 Keystone — 认证、授权与服务发现

Keystone 承担三个职责，缺一不可：**① 认证（Authentication）**、**② 授权（Authorization）**、**③ 服务目录（Service Catalog）**。将其简单理解为「登录服务」是面试失分的典型错误。

#### 核心概念

| 概念 | 作用 | 面试关注点 |
|------|------|------------|
| Domain | 身份管理边界，支持多 LDAP/AD 联邦 | 多租户隔离的顶层边界 |
| Project | 资源隔离和配额的基本单位 | 租户资源、Network、Volume 归属 |
| Role + Policy | RBAC 授权模型，policy.yaml 控制 API 权限 | 细粒度权限裁剪，最小权限原则 |
| Token (Fernet) | 携带用户身份和权限的短期凭证 | 无状态、不写 DB、轮换机制 |
| Service Catalog | 各组件 endpoint 的注册表 | 客户端拿 Token 后如何发现 API 地址 |
| Application Credential | 服务账号凭证，不依赖用户密码 | CI/CD、自动化工具认证首选 |

#### Fernet Token 原理与高可用关键

Fernet Token 是对称加密的，验证不需要查库，这是相对 UUID Token 的核心优势。但多节点 Keystone 部署中，**Fernet key 的分发和轮换同步**是最大的运维陷阱。

```
Fernet Key 目录结构（每个控制节点必须完全一致）：
/etc/keystone/fernet-keys/
  0    ← 当前加密 key（Primary）
  1    ← 上一轮密钥（Staged，用于解密旧 token）
  ...  ← 历史密钥（rotation 保留数量由 max_active_keys 决定）

轮换流程：
  keystone-manage fernet_rotate  → 在一个节点执行
  ansible / cron / Vault         → 同步到所有控制节点
  ⚠ 未同步前，该节点签发的 Token 在其他节点无法验证 → 401
```

> **Q: 为什么多控制节点会出现偶发 401？**  
> A: 最大概率是 Fernet key 未同步。某节点 rotate 后发出的 Token，其他节点因缺少新 Primary key 而验证失败。
>
> **Q: Keystone 挂了会怎样？**  
> A: 正在运行的 VM 不受影响（数据面不依赖 Keystone），但所有新 API 调用、token 续期、服务间认证均会失败，nova/neutron/cinder 之间的 service account 调用也会中断。
>
> **Q: application credential 和 service user 的区别？**  
> A: application credential 绑定到特定项目和角色，不随用户密码变更失效，适合自动化场景；service user 是服务组件自己的身份账号，通常权限更宽。

---

### 3.2 Nova — 计算控制面本质是分布式状态机

Nova 不是 Hypervisor，它是**计算资源的编排和调度控制面**，通过驱动框架对接 libvirt/Hyper-V/VMware 等底层。

#### 核心进程职责

| 进程 | 职责 | 故障影响 |
|------|------|----------|
| nova-api | 接受外部请求，参数校验，写入 DB 初始状态 | API 不可用，无法新建/删除实例 |
| nova-scheduler | 从 Placement 获取候选 Host，执行 Filter/Weigh 算法 | 调度停止，积压请求，已运行 VM 不受影响 |
| nova-conductor | 控制面编排中枢，代替 compute 写 DB，降低数据库暴露面 | 任务编排中断，Conductor 是扩展性关键 |
| nova-compute | 与 libvirt 交互，管理本地虚机生命周期 | 该宿主机实例操作失败，疏散触发 |
| placement-api | 资源库存（inventory）、特性（traits）、分配（allocations） | 视图错误 → 调度失败，是 `No valid host` 首查对象 |

#### Cells v2 架构 — 大规模扩展的关键

单 Cell 部署在几百节点后，RabbitMQ 和 MariaDB 会成为瓶颈。Cells v2 通过分片解决规模问题：

```
Nova Cells v2 逻辑结构：

  API Cell（全局）
  ├── nova-api          ← 统一入口，维护全局 project/quota
  ├── nova-scheduler    ← 跨 cell 调度
  ├── nova-conductor    ← 全局编排
  └── cell0             ← 专门存调度失败实例（ERROR/DELETED）

  Cell 1                Cell 2                Cell N
  ├── 独立 RabbitMQ     ├── 独立 RabbitMQ     ├── ...
  ├── 独立 MariaDB      ├── 独立 MariaDB      ├── ...
  └── N 个 compute      └── N 个 compute      └── ...

  关键：每个 Cell 的消息和数据库边界相互隔离，故障不跨 Cell 扩散
```

> **Cells v2 面试要点**
> - `cell0` 的意义：调度失败的实例不进任何真实 cell，进 cell0，方便统一查询失败记录
> - 跨 cell 实例列表：`nova list` 会跨所有 cell 聚合，需要 nova-conductor 的 superconductor 模式
> - 升级注意：`nova-manage cell_v2` 系列命令，错误操作会导致 compute 节点从调度视图消失
> - 扩展上限：单 cell 建议不超过 500–1000 个 compute 节点（取决于 RabbitMQ 和 DB 规格）

---

### 3.3 Neutron — 网络虚拟化控制面

Neutron 管的是**「网络意图」**，不直接等于「交换机配置」。它通过插件体系把抽象模型（Network/Subnet/Port/Router/FIP）落到具体数据面实现。

#### ML2 插件体系

```
Neutron Server
  │
  ├── Core Plugin: ML2 (Modular Layer 2)
  │     ├── Type Driver: flat / vlan / vxlan / gre / geneve
  │     └── Mechanism Driver:
  │           ├── openvswitch  → OVS agent 模式（经典）
  │           ├── ovn          → OVN 模式（新建云主流）
  │           ├── linuxbridge  → 轻量级，不支持 VXLAN offload
  │           └── sriovnicswitch → SR-IOV 直通
  │
  └── Service Plugin:
        ├── L3 Router (namespace / DVR / OVN L3)
        ├── DHCP Agent
        ├── Metadata Agent
        ├── LBaaS (Octavia)
        └── FWaaS / VPNaaS
```

#### OVS 模式 vs OVN 模式

| 维度 | ML2 + OVS（传统） | ML2 + OVN（现代） |
|------|-------------------|-------------------|
| 架构 | 每节点 OVS agent + neutron-server 下发 | OVN NB DB → OVN SB DB → ovn-controller |
| 二层 | br-int / br-tun / br-ex bridge 链 | Logical Switch，ovn-controller 本地计算流表 |
| 三层 | router namespace（集中）/ DVR（分布式） | OVN L3 原生分布式，无需 router namespace |
| 安全组 | iptables / nftables（每端口规则） | OVN ACL，下沉到 OVS 流表，性能更好 |
| DHCP | DHCP namespace + dnsmasq | OVN 内置 DHCP，无 DHCP agent |
| 排障 | 直观，namespace / bridge 可见 | 需要 ovn-nbctl / ovn-sbctl 工具链 |
| 规模 | agent 多，控制面复杂 | 控制面更简洁，适合大规模 |

---

### 3.4 Cinder — 块存储编排层

**关键认知**：Cinder 不是存储本体，而是存储编排控制面。真实数据在哪、性能如何、HA 如何，取决于后端 driver。

| 进程 | 职责 |
|------|------|
| cinder-api | 接受卷/快照/备份 CRUD 请求，参数校验，写入 DB |
| cinder-scheduler | 根据容量、能力、QoS 策略选择后端 storage pool |
| cinder-volume | 驱动 Ceph RBD / FC / iSCSI / NFS / LVM 执行实际操作 |
| cinder-backup | 将卷/快照数据流式读取后写入备份后端（Swift/Ceph/NFS） |

| 能力 | 说明 | 运维注意 |
|------|------|----------|
| 卷类型（Volume Type） | 绑定后端 pool 和 QoS 策略，支持不同性能级别 | 不同 type 可对应 Ceph SSD / SATA 不同 pool |
| 快照（Snapshot） | 基于 CoW 的逻辑一致点，依赖后端能力 | 不能跨后端，不能当独立备份 |
| 备份（Backup） | 真实数据导出到备份后端，支持增量 | cinder-backup 是瓶颈，需独立资源 |
| 复制（Replication） | 后端级别跨站同步（Ceph RBD mirroring 等） | RPO 接近 0，成本高，需专线带宽 |
| Retype / Migrate | 卷跨后端迁移，支持在线/离线 | 需两端后端同时可达，迁移期间 IO 抖动 |

---

### 3.5 Placement — 调度的资源真相来源

Placement 是最容易被轻视但最重要的组件之一。**`No valid host` 问题的根因有 60% 以上在 Placement 视图。**

| 概念 | 说明 |
|------|------|
| Resource Provider (RP) | 代表一个可提供资源的实体（compute node、NUMA node、PCI 设备） |
| Inventory | RP 能提供的资源上限（total）、保留量（reserved）、超配比（allocation_ratio） |
| Allocation | 已分配给某实例的资源量，nova-compute 在 VM 启动时提交 |
| Trait | RP 具备的能力标签，如 `HW:CPU_X86_AVX512F`、`STORAGE:REMOTE_BLOCK`、`CUSTOM_*` |
| Aggregate | RP 的分组，用于将 compute host 和存储/网络资源绑定（调度约束用） |

```bash
# 调度失败排查路径（No valid host）

# 1. 确认 compute 节点是否已注册 RP
openstack resource provider list

# 2. 检查 VCPU/MEMORY_MB/DISK_GB 的 total/reserved/allocation_ratio
openstack resource provider inventory list <rp_uuid>

# 3. 是否有僵尸 allocation 占用资源（VM 删除后残留）
openstack resource provider allocation list <rp_uuid>

# 4. Flavor extra_specs 要求的 trait 是否存在
openstack resource provider trait list <rp_uuid>

# 5. 修复不一致的 allocation（慎用，需在维护窗口执行）
nova-manage placement heal_allocations
```

---

### 3.6 其他重要组件

| 组件 | 核心功能 | 面试要点 |
|------|----------|----------|
| Glance | 镜像元数据管理 + 分发 | 瓶颈在镜像后端吞吐和并发拉取；支持 image conversion（qcow2↔raw） |
| Heat | 基础设施编排（IaC） | 类比 Terraform 的云原生实现；HOT 模板支持条件、依赖、嵌套栈 |
| Octavia | LBaaS，通过 Amphora VM 或 provider driver 实现 | Amphora 本身是 VM，其 HA 取决于 active-standby 模式 |
| Barbican | 密钥、证书、Secret 管理 | 支持 HSM backend；Cinder 卷加密、TLS termination 场景必用 |
| Ironic | 裸金属即服务（BaaS） | IPMI/Redfish 管理物理机，支持 PXE/iSCSI/direct 部署；与 Nova 集成 |
| Designate | DNS 即服务（DNSaaS） | 为 FIP / LB VIP 自动创建 DNS 记录；后端可对接 BIND/PowerDNS |
| Manila | 共享文件系统即服务 | 多 VM 共享访问场景；后端支持 CephFS、NetApp、GlusterFS |

---

## 四、备份原理与容灾架构

### 4.1 概念辨析：快照、备份、复制

这是面试必考题，三个概念的边界必须清晰：

| 能力 | 本质 | 故障域 | RPO | RTO | 典型用途 |
|------|------|--------|-----|-----|----------|
| 快照 Snapshot | CoW 逻辑一致点 | 与原卷共享同一存储 | 分钟级（需一致性组） | 分钟级 | 快速回滚、模板制作 |
| 备份 Backup | 数据导出到独立介质 | 可跨故障域 | 小时级（取决于周期） | 小时级 | 长期保留、灾难恢复 |
| 复制 Replication | 持续同步到另一位置 | 完全分离 | 秒级（异步）/ 0（同步） | 分钟级 | 容灾、异地切换 |

> **经典面试陷阱**
>
> **Q: 卷快照能当备份用吗？**  
> A: 不能完全等同。快照依赖原存储后端，后端整体故障时快照随之丢失。真正的备份必须把数据导出到独立故障域的介质。快照可以作为备份链路的「起点」（先快照再备份），但不能替代备份。
>
> **Q: 备份了 OpenStack 数据库就算完成了吗？**  
> A: 不是。数据库只是控制面状态（资源元数据），租户卷里的实际数据不在 DB 里。数据库恢复只能让云「知道资源还在」，不代表数据可读。

---

### 4.2 OpenStack 备份四层架构

| 层次 | 备份内容 |
|------|----------|
| **第一层：控制面状态** | MariaDB/Galera 全量+增量备份、RabbitMQ definitions export、Keystone Fernet keys、所有服务配置文件（`/etc/nova/` `/etc/neutron/` 等）、TLS 证书、OVN NB/SB DB（`ovn-nbctl backup`） |
| **第二层：镜像数据** | Glance 镜像文件（通常在 Ceph pool 或 Swift）+ 镜像元数据（DB）；大环境建议对镜像 pool 做 Ceph RBD export 或 S3 同步 |
| **第三层：卷数据** | Cinder backup（流式导出到 Swift/Ceph/NFS）；高价值卷可叠加 Ceph RBD mirroring 做异地复制；快照作为短期保护层 |
| **第四层：业务数据** | VM 内应用层数据库（mysqldump / pg_dump）、应用配置、用户上传数据；OpenStack 不管这一层，需应用自己负责 |

---

### 4.3 Cinder 备份原理（深度）

```
Cinder Backup 数据流：

  运行中的 Volume
       │
       ├── (推荐) 先创建 Snapshot → 基于快照备份（避免 IO 不一致）
       │
       ▼
  cinder-backup 进程
       │
       ├── 读取卷/快照数据块（按 chunk_size 分片）
       ├── SHA256 校验（确保数据完整性）
       ├── 可选 zlib 压缩
       ├── 可选 AES 加密（结合 Barbican）
       │
       ▼
  备份后端写入
  ├── Swift  → 对象存储，支持大规模水平扩展
  ├── Ceph   → 写入独立备份 pool，可跨站复制
  ├── NFS    → 简单，性能受 NFS 服务器限制
  └── Posix  → 本地文件系统（不推荐生产）
       │
       ▼
  DB 记录：backup chain + 每个 chunk 的偏移/哈希/元数据
       │
       ▼
  恢复 (Restore)
  ← 从后端读取 chunks → 解压/解密 → 写入目标卷
```

| 问题 | 根因 |
|------|------|
| 增量备份原理 | 对比前一次备份记录的 chunk 哈希，只传输变化的 chunk。Ceph 后端可利用 RBD diff 精确到 4MB 块；Swift 需全量比对。 |
| 备份慢的根因 | 需真实读取所有数据块（非元数据操作），受限于：① 源卷 IO 速率 ② 网络带宽 ③ 备份后端写入速率 ④ 压缩 CPU 消耗 |
| 恢复慢的根因 | chunk 解压、网络传输、目标卷顺序写入三阶段串行；并发恢复时内存和 CPU 压力明显 |
| 一致性保证 | 对运行中 VM 的卷备份存在 crash-consistent 风险。生产建议：① 通知应用层 quiesce ② 使用 Nova instance-backup ③ 基于 snapshot 备份减少不一致窗口 |

---

### 4.4 控制面灾难恢复顺序

控制面完全故障时，恢复顺序必须遵循依赖关系：

1. **基础设施层**：DNS 解析、NTP 时钟同步、VIP/Keepalived、TLS 证书、操作系统、容器运行时
2. **数据层**：MariaDB/Galera 恢复并确认 Primary Component（`wsrep_cluster_status`）、RabbitMQ 恢复并导入 definitions、Memcached 清空重启（无需备份，状态可重建）
3. **身份层**：Keystone 配置文件 + Fernet keys 恢复到所有控制节点并确保一致
4. **核心 API 层**：按顺序启动 Glance → Placement → Nova-API/Scheduler/Conductor → Neutron → Cinder，每层验证 `openstack * list` 可返回结果
5. **网络控制层**：OVN NB/SB DB 恢复或 Neutron agents 重启，重新触发 port binding 同步
6. **计算层**：nova-compute 重新注册到 Placement，验证 `hypervisor list`，确认 VM 状态与实际一致
7. **外围服务**：Octavia、Heat、Designate 等按业务优先级恢复

> **最容易忽视的陷阱**
> 1. **Fernet keys 不一致**：所有节点 keys 目录不同步 → 旧 token 全部失效，服务间认证中断
> 2. **MQ definitions 未恢复**：数据库恢复了但 RabbitMQ vhost/user/policy 丢失 → 任务发不出去，服务看起来在线实则无法通信
> 3. **Galera 脑裂恢复错误**：误操作 `--wsrep-new-cluster` 在非最新节点 → 丢失部分事务
> 4. **Placement allocation 不一致**：VM 实际在跑但 allocation 丢失 → 调度视图资源虚高，可能导致超卖
> 5. **OVN DB 与实际流表不同步**：OVN NB/SB 恢复后需等待 ovn-controller 重新下发，期间网络可能中断

---

## 五、网络原理与故障排查

### 5.1 生产网络分区规划

| 网络类型 | 承载流量 | 建议带宽 | 隔离要求 |
|----------|----------|----------|----------|
| 管理网（Management） | API / SSH / 数据库 / MQ / 控制面服务 | 1–10 GbE | ACL 严格限制，仅内部访问 |
| 租户 Overlay 网（Tenant） | VXLAN/GENEVE 封装的东西向 VM 流量 | 25–100 GbE | 物理或 VLAN 隔离 |
| 存储网（Storage） | Ceph / iSCSI / NFS 数据和心跳 | 25–100 GbE（独立） | 与 overlay 强制隔离，避免带宽抢占 |
| 外部/Provider 网（External） | FIP / SNAT / 对外服务出口 | 按业务规划 | 与物理网络边界清晰对接 |
| OOB 带外网（OOB） | BMC / IPMI / 交换机管理 | 1 GbE | 完全隔离，仅运维访问 |

---

### 5.2 数据包完整路径

#### 东西向流量（同租户跨宿主机）

```
VM A (Host 1)                              VM B (Host 2)
   │                                           ▲
   ▼                                           │
tap interface                           tap interface
   │                                           │
   ▼                                           │
Security Group (iptables/nftables/OVN ACL)     │
   │                                           │
   ▼                                           │
br-int (OVS)                            br-int (OVS)
   │                                           │
   ▼                                           │
br-tun (OVS)                            br-tun (OVS)
   │                                           │
   ▼    VXLAN/GENEVE Encapsulation             │
物理网卡 ──────── underlay 网络 ──────────► 物理网卡
                                               │
                                         解封装/分类
```

#### 南北向流量（VM 访问外网）

```
VM
  │
  ▼
tap → br-int → virtual router（OVS flow / router namespace）
  │
  ├── Floating IP: DNAT/SNAT（1:1 映射）
  │
  └── SNAT: 多 VM 共享 router external IP 出网
  │
  ▼
br-ex → 物理网卡（provider/external network）
  │
  ▼
物理交换机 → 互联网 / 企业网络

注意：DVR 模式下，SNAT 流量仍经 Network 节点；FIP 流量在 Compute 节点本地处理
```

---

### 5.3 MTU — 最隐蔽的网络杀手

MTU 配置错误是私有云网络问题的头号根因，症状是「小包通、大包丢」，极难复现和排查。

```
MTU 计算公式（VXLAN）：
  物理 MTU          = 1500（默认以太网）
  VXLAN 头开销      = 50 字节（UDP 8B + VXLAN 8B + Outer ETH 14B + Outer IP 20B）
  VM 内最大 MTU     = 1500 - 50 = 1450

  如果物理交换机支持 Jumbo Frame（9000）：
  VM 内 MTU 可设到  = 9000 - 50 = 8950

GENEVE 头开销约 58 字节（含可变选项），建议 VM MTU = 1442，或要求全链路 Jumbo Frame

配置路径：
  neutron.conf:    global_physnet_mtu
  ml2_conf.ini:    path_mtu（隧道 MTU）
  VM 侧:           通过 DHCP option 26 下发给虚机
```

---

### 5.4 网络 8 大翻车点（附验证命令）

| 翻车点 | 根因 | 快速验证 |
|--------|------|----------|
| MTU 不一致 | overlay 头未计入，大包丢弃 | `ping -M do -s 1450 <dst>`；`tcpdump` 抓截断包 |
| bridge_mappings 错误 | physnet 名称控制节点和计算节点不匹配 | `neutron agent-show <agent-id>` 查 configurations |
| VLAN trunk 未放通 | 物理交换机没有放通 provider VLAN | 交换机 `show interface trunk`；从 VM ping gateway |
| Metadata 链路断 | 169.254.169.254 路由异常或 metadata-agent down | `ip netns exec <ns> curl http://169.254.169.254` |
| Security Group 残缺 | 只放了 ingress 忘了 egress，或 conntrack 满 | `openstack security group rule list`；`conntrack -L \| wc -l` |
| Overlay 隧道不通 | 宿主机防火墙拦截 UDP 4789(VXLAN)/6081(GENEVE) | `nc -u <remote-host> 4789`；`iptables -L -n \| grep 4789` |
| DVR 路由缺失 | 计算节点未正确下发分布式路由 | `ip netns exec qrouter-* ip route`；`ovn-nbctl lr-route-list` |
| 外部交换机 ECMP/LACP 不匹配 | bond/LACP 哈希策略导致单向流量 | `ethtool -S <nic>` 查看收发计数；交换机 LAG 配置核对 |

---

## 六、故障排查矩阵

### 6.1 通用排障方法论

**原则**：不要上来就翻日志。先确定失败发生在哪一层，再聚焦日志。

1. **确定失败层**：API 层？调度层？网络绑定层？存储层？Hypervisor 层？
2. **检查资源状态闭环**：实例、Port、Volume、Allocation、Backup 状态是否内部一致？有无孤儿资源？
3. **验证依赖组件健康**：Keystone → RabbitMQ → MariaDB → Placement → OVN/OVS → Ceph，按依赖顺序检查
4. **验证宿主机本地状态**：bridge/namespace/tap/iptables/libvirt domain/块设备映射是否正确
5. **最后看日志细节**：精确定位到 request-id / instance-id，跨服务日志关联

---

### 6.2 高频故障排查矩阵

| 故障现象 | 首要根因 | 排查路径 | 解决方向 |
|----------|----------|----------|----------|
| `No valid host was found` | Placement 视图错误 / trait 不匹配 / aggregate 约束 | `openstack resource provider list/inventory/trait`；nova-scheduler.log filter 拒绝原因 | 修复 inventory 数据；清理僵尸 allocation；检查 Flavor extra_specs |
| `Exhausted all hosts available` | 调度到主机后在网络/存储/libvirt 环节连续失败 | nova-conductor.log；nova-compute.log；neutron server.log | 逐一检查 PortBinding / volume attach / libvirt 日志 |
| `PortBindingFailed` / 实例起不来 | ML2 binding 失败、agent down、physnet 名错 | `neutron agent-list`；`ovs-vsctl show`；OVN NB 日志 | 重启 OVS agent；修正 bridge_mappings；检查 OVN controller |
| 实例建成但无 IP | DHCP agent / metadata 异常；subnet 配置错误 | `ip netns exec qdhcp-* ip a`；dnsmasq 进程；port 状态 | 重启 DHCP agent；检查 subnet dns_nameservers；验证 SG |
| 内网通、外网不通 | SNAT/FIP 链路断；router external 未关联；MTU | `ip netns exec qrouter-* ip r`；`iptables -t nat -L`；`ping -s 1450` | 检查 FIP association；验证 external network VLAN；MTU 对齐 |
| 卷卡在 `attaching` | Ceph 降级 / iSCSI session 断 / nova-cinder 状态不一致 | cinder-volume.log；nova-compute.log；`rbd ls` / `iscsiadm -m session` | 强制 reset volume state；清理残留 session；重建 RBD 映射 |
| 备份卡在 `creating` | cinder-backup 进程、RabbitMQ、备份后端异常 | cinder-backup.log；`swift stat` / `rbd -p backup ls`；MQ 队列积压 | 重启 cinder-backup；清理后端残留对象；reset backup state |
| 偶发 401 / 跨节点认证失败 | Fernet key 未同步；时钟漂移 > 允许值（默认 5 分钟） | `diff` 各节点 `/etc/keystone/fernet-keys/`；`chronyc tracking` | 同步 fernet-keys；强制对时；重启 Keystone |
| Live migration 失败 | CPU 特性不兼容；目标机存储/网络不可达；内存超配 | libvirt 迁移日志；`cpu flags` 对比；目标机 placement allocation | 统一 CPU model；检查共享存储挂载；确认 hugepage 预留 |
| `AMQP server is unreachable` | RabbitMQ 不通、网络分区、磁盘水位触发 flow control | `rabbitmqctl cluster_status`；`df -h /var/lib/rabbitmq`；netstat | 检查 MQ 磁盘空间；重建集群成员；调整 disk_free_limit |
| `WSREP has not yet prepared node` | Galera 节点不在 Primary Component 或未同步 | `show status like 'wsrep%'`；Galera 日志；磁盘空间 | 按正确顺序执行 bootstrap；检查网络分区；清理磁盘 |

---

### 6.3 关键日志位置

| 服务 | 日志路径 | 重点查什么 |
|------|----------|------------|
| nova-api | `/var/log/nova/nova-api.log` | API 请求接入、配额检查、参数校验 |
| nova-scheduler | `/var/log/nova/nova-scheduler.log` | Filter 拒绝原因，是 `No valid host` 的直接证据 |
| nova-conductor | `/var/log/nova/nova-conductor.log` | 编排任务异常、跨 cell 路由 |
| nova-compute | `/var/log/nova/nova-compute.log` | libvirt 调用、attach 操作、迁移 |
| neutron-server | `/var/log/neutron/server.log` | 端口创建/删除、binding 过程 |
| cinder-volume | `/var/log/cinder/cinder-volume.log` | 后端驱动操作、attach/detach |
| cinder-backup | `/var/log/cinder/cinder-backup.log` | 备份/恢复任务进度和错误 |
| Keystone | `/var/log/httpd/` 或 `journalctl -u openstack-keystone` | token 签发/验证 |
| libvirt | `journalctl -u libvirtd`；`/var/log/libvirt/qemu/<instance>.log` | 虚机启动/迁移/崩溃 |
| OVN/OVS | `/var/log/ovn/`；`ovs-vsctl show`；`ovn-nbctl dump-flows` | 流表下发、控制器状态 |

---

## 七、私有云建设实战要点

### 7.1 架构设计先于安装

最常见的错误是「先装好 OpenStack 再想网络和 HA」。开工前必须回答：

1. **多租户强度**：强多租户（self-service overlay + 配额严格隔离）还是企业单租户（provider network + 简化管理）？
2. **目标规模**：< 50 节点可简单架构；> 200 节点需规划 cells v2、专用网络节点、独立存储网络；> 1000 节点需考虑多 region 或联邦。
3. **负载特征**：普通业务 VM / 数据库（NUMA + hugepage）/ GPU 直通（SR-IOV/VFIO）/ NFV（DPDK + huge）/ VDI，各有不同硬件和 flavor 要求。
4. **HA 目标**：控制面 HA（3 节点 + VIP）+ 数据面容灾（Ceph 跨站复制）+ 业务级 RPO/RTO 是三个独立维度，需分别设计。
5. **运营团队能力**：OpenStack 不是托管服务，需要团队覆盖网络、存储、Linux、自动化、监控全栈。

---

### 7.2 控制面高可用设计

3 个控制节点 + VIP 是最低标准，但不是充分条件。

| 组件 | HA 方案 | 关键配置 | 常见陷阱 |
|------|---------|----------|----------|
| API 入口 | HAProxy + Keepalived VIP | health check interval；backend timeout | VIP 飘移时 session 丢失，API 需幂等 |
| MariaDB/Galera | 3 节点同步复制 | wsrep_cluster_size=3；gcache 大小 | 脑裂恢复错误；磁盘满触发 SST；时钟漂移 |
| RabbitMQ | 3 节点 Quorum Queue | disk_free_limit；net_ticktime；ha-mode all | 消息积压触发 flow control；磁盘水位；网络分区 |
| Keystone | 多节点无状态（Fernet） | fernet key 同步机制；token expiry | key 不同步导致偶发 401 |
| OVN NB/SB DB | Raft 3 节点 | ovn-northd HA；ovn-controller 本地自治 | DB leader 切换期间下发暂停 |
| Placement | 多节点无状态（读写 DB） | DB 连接池；API 超时 | DB 慢查询会直接导致调度超时 |

---

### 7.3 存储选型决策

| 方案 | 适用场景 | 优势 | 挑战 | OpenStack 集成 |
|------|----------|------|------|----------------|
| Ceph RBD | 大规模统一存储（卷+镜像+对象） | 弹性扩展、深度集成、多租户 QoS | 运维复杂度高；网络要求严格 | Cinder/Glance/Nova 均原生支持，共享 pool 减少镜像拷贝 |
| FC SAN | 高性能数据库、低时延场景 | 极低时延、协议成熟 | 扩展性差、成本高、需 FC 交换机 | Cinder FC driver；需 FC HBA 和 zone 配置 |
| iSCSI | 传统企业环境迁移、中等规模 | 成本低、IP 网络承载 | 性能和可靠性不及 FC；需独立存储网 | Cinder iSCSI driver；LVM 或 NetApp/Pure 等 |
| NFS | 小规模验证、非关键业务 | 最简单、零额外硬件 | 锁语义复杂；高并发 IO 差；单点风险 | Cinder NFS driver；Glance NFS store |

**结论**：Cinder 负责「编排卷」，后端决定「卷到底好不好用」。评估 OpenStack 存储能力时，必须同时看 Cinder 架构和后端存储架构。

---

### 7.4 硬件基础规范

| 项目 | 要求 |
|------|------|
| CPU 虚拟化 | 所有宿主机统一开启 VT-x/AMD-V；CPU 型号差异影响 live migration，建议同代同型号或配置 CPU baseline 模式 |
| NUMA 规划 | 高性能 VM（数据库/NFV）需 NUMA 亲和性，涉及 Nova flavor extra_specs、BIOS NUMA 拓扑、Placement NUMA trait |
| SR-IOV / DPDK | NFV 场景需从网卡、BIOS、内核参数（hugepage、isolcpu）、OVS-DPDK、Nova PCI passthrough 全链路规划 |
| 时钟同步 | NTP 漂移 > 5 分钟会导致 Keystone token 失效、Galera 对时钟敏感；建议 Chrony + 内部 NTP，监控 offset |
| 磁盘 IO | 控制节点 DB 和 MQ 必须使用 SSD；Ceph OSD 节点分开数据盘和日志盘；避免控制面和数据面共用磁盘 |
| 网卡绑定 | 控制面建议 active-backup bond；数据面建议 LACP bond 或多队列网卡；注意与交换机 LACP/ECMP 策略对齐 |

---

### 7.5 自动化部署与 Day-2 运营

**核心观点**：自动化运营的投入比 Day-0 安装更重要。一个「部署简单但无法自动恢复」的云，在生产中风险极高。

| 运营能力 | 建设要求 | 工具参考 |
|----------|----------|----------|
| 配置即代码 | 所有配置纳入版本控制，环境可重复 | Ansible / Kolla-Ansible / TripleO / Helm |
| 密钥/证书管理 | Fernet keys、TLS 证书、服务密码统一分发和轮换 | Vault / Ansible Vault / cert-manager |
| 标准化变更流程 | 升级、扩容、节点替换有 Runbook 和回滚方案 | GitOps + CI/CD Pipeline |
| 监控告警 | 控制面进程、MQ 队列、DB 延迟、Ceph 健康、VM 密度 | Prometheus + Grafana + Alertmanager |
| 日志聚合 | 跨节点日志统一查询，支持 request-id 关联 | ELK / Loki + Grafana |
| 容量规划 | vCPU/内存/存储使用率趋势，提前扩容 | Gnocchi / InfluxDB / Prometheus 自定义指标 |
| 备份恢复演练 | 定期执行 DB 恢复、卷恢复、控制面重建演练 | 季度演练计划 + 演练报告归档 |

---

## 八、高频追问与标准答法

### Q1：为什么 OpenStack 被认为「很复杂」

> OpenStack 的复杂性来自三个维度叠加：
> - **分布式系统复杂性**：多个有状态服务通过消息总线和数据库协作，网络分区、时钟漂移、消息丢失都会引发级联问题。
> - **可插拔性复杂性**：hypervisor / 网络机制 / 存储后端的排列组合庞大，每种组合都有独立的调优和排障路径。
> - **多租户隔离复杂性**：在同一物理基础设施上实现强安全隔离、独立网络、独立配额，要求各层协同。
>
> 三者叠加后，单个 API 调用可能触发十几个服务的联动，任何一环的异常都可能导致整体不可预期的行为。

---

### Q2：Nova、Neutron、Cinder 三者关系

> Nova 是计算编排核心，负责实例生命周期和调度决策，是另外两者的「调用方」。Neutron 负责网络意图（Port/Router/SG/FIP）的建模和下发，与 Nova 的交互点在 port binding（绑定 vNIC 到 compute host）。Cinder 负责块存储卷的生命周期和后端编排，与 Nova 的交互点在 volume attach/detach。
>
> **三者共同点**：都不直接处理数据面流量，而是通过控制命令驱动各自的数据面（libvirt/OVS/Ceph）完成真实工作。

---

### Q3：OpenStack 最关键的外部依赖

| 依赖 | 为什么关键 |
|------|------------|
| MariaDB/Galera | 所有控制面状态的持久化存储，主库故障 = 控制面完全停止 |
| RabbitMQ | 异步任务总线，nova/neutron/cinder RPC 依赖，积压或分区会导致任务挂起 |
| Keystone Fernet Keys | 多节点不同步 = 跨节点认证失败；丢失 = 所有 token 失效 |
| 底层网络 | MTU、VLAN trunk、物理拓扑错误会导致 overlay 完全不通，排查极难 |
| 存储后端 | Ceph 健康状态直接决定卷和镜像的可用性；Ceph 降级会导致 IO hang |
| NTP 时钟 | 漂移影响 token 校验、Galera 同步、RabbitMQ 心跳，是被低估的隐患 |

---

### Q4：私有云上线前必须完成的演练

1. **控制节点单点失败切换**：关闭一个控制节点，验证 VIP 漂移、API 可用性、RabbitMQ/Galera 自动选主
2. **RabbitMQ 集群故障恢复**：模拟一个 MQ 节点宕机，验证消息不丢失、任务继续执行
3. **MariaDB 恢复演练**：从备份完整重建 DB 并验证所有服务可读写，包括 Schema 版本验证
4. **Keystone Fernet Key 轮换**：执行 rotate 并同步所有节点，验证业务无中断
5. **网络回归测试**：MTU 验证（`ping -M do -s 1450`）；FIP 和 SNAT 验证；跨宿主机东西向验证
6. **Cinder 卷完整恢复**：从备份还原卷，挂载到新 VM，验证数据完整性（`md5sum`）
7. **大规模并发创建压测**：并发创建 50–200 个实例，验证调度器、MQ、DB 在压力下的稳定性
8. **存储故障模拟**：模拟 Ceph OSD 宕机，验证 IO 降级但不中断；模拟 OSD 磁盘满，验证告警和限速

---

## 九、快速记忆卡片

### 核心依赖链

```
NTP 时钟同步
  ↓
MariaDB/Galera（所有控制面状态持久化）
  ↓
RabbitMQ（服务间异步 RPC）
  ↓
Keystone（Fernet keys 同步）→ 认证授权基础
  ↓
Placement → 资源视图（调度基础）
  ↓
Nova-API / Nova-Scheduler / Nova-Conductor
  ↓
Neutron-Server + OVN/OVS → 网络控制下发
  ↓
Cinder-Volume + Ceph/SAN → 存储编排
  ↓
nova-compute + libvirt → 实际启动虚机
```

---

### `No valid host` 速查

```bash
# 1. RP 是否注册
openstack resource provider list

# 2. VCPU/MEM/DISK 余量
openstack resource provider inventory list <rp_uuid>

# 3. 有无僵尸 allocation
openstack resource provider allocation list <rp_uuid>

# 4. Flavor 要求的 trait 是否存在
openstack resource provider trait list <rp_uuid>

# 5. Filter 被哪个过滤器拒绝
grep "No valid host" /var/log/nova/nova-scheduler.log

# 6. AZ/aggregate 约束
openstack aggregate list
openstack aggregate show <aggregate>
```

---

### 备份检查清单

- [ ] **控制面**：DB 每日全量 + 增量；MQ definitions；Fernet keys；所有 `/etc/*` 配置目录；TLS 证书
- [ ] **镜像**：Glance 镜像 pool 异地同步或 Ceph RBD export
- [ ] **数据卷**：Cinder backup 到独立后端（非同一 Ceph 集群）+ Ceph RBD mirroring（高价值卷）
- [ ] **业务层**：应用数据库备份 + 应用配置 + 用户数据
- [ ] **验证**：至少每季度执行一次完整恢复演练，记录 RTO/RPO 实测值

---

### 面试收尾话术

> OpenStack 的核心不是组件数量多，而是它把认证、调度、网络虚拟化、块存储编排和多租户隔离组合成一个可运维的 IaaS 平台。
>
> **架构层面**：抓住控制面和数据面分离，抓住状态持久化（DB）、异步解耦（MQ）和资源视图（Placement）三个支柱。
>
> **备份层面**：控制面状态和租户数据是两条独立的备份线，缺任何一条都不完整。
>
> **排障层面**：先确定失败层，再检查状态闭环，再看依赖组件，最后看日志。
>
> **私有云建设**：先做网络和故障域设计，再做安装；先做 HA 和备份演练，再上线业务。
>
> 真正成熟的 OpenStack 方案，标准不是「服务都启动了」，而是「故障来了能定位、能切换、能恢复、能在不重建环境的情况下扩容」。