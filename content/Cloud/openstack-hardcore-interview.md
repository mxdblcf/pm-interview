---
title: "OpenStack 面试宝典（架构 / 备份 / 组件 / 排障 / 私有云）"
category: "Cloud"
order: 1
---

# OpenStack 面试宝典

> 目标：这是一份既能拿去面试，也能拿去做私有云规划、上线排障、容灾演练的高密度手册。  
> 阅读建议：先背 `1. 一句话打穿`、`5. 备份原理`、`7. 常见报错`、`8. 私有云搭建注意事项`，再看细节。  
> 方法论：不要把 OpenStack 当成“装一堆服务”。它本质上是一个把计算、网络、存储、身份、调度、配额、多租户和高可用编排在一起的 IaaS 控制面。

<div class="interview-grid">
  <div class="interview-card">
    <strong>一句话定位</strong>
    <p>OpenStack 不是单体软件，而是一组通过 API、消息总线、数据库和驱动框架拼起来的云操作系统。</p>
  </div>
  <div class="interview-card">
    <strong>核心矛盾</strong>
    <p>面试真正要听的不是组件名，而是你能不能说清“状态在谁手里、流量走哪条路径、故障怎么收敛”。</p>
  </div>
  <div class="interview-card">
    <strong>最容易挂的地方</strong>
    <p>不是单个 API，而是 RabbitMQ、MariaDB、Keystone Fernet key、Neutron MTU、Placement 资源视图和底层存储一致性。</p>
  </div>
  <div class="interview-card">
    <strong>私有云成败关键</strong>
    <p>前期网络规划、故障域设计、自动化部署、备份恢复演练，比“把服务跑起来”重要得多。</p>
  </div>
</div>

## 1. 一句话打穿

30 秒版本可以这样答：

> OpenStack 是一个 IaaS 云平台控制面，核心是 Keystone 做身份和服务目录，Nova 管计算生命周期，Neutron 管网络虚拟化，Cinder/Glance/Swift 管块存储、镜像和对象存储，再通过 RabbitMQ、MariaDB、Placement、OVS 或 OVN、Ceph 等基础组件把请求变成真实的资源创建、调度、挂载和转发。

再进一层：

> OpenStack 的难点不在于 API 多，而在于它是“控制面分布式系统 + 数据面多驱动系统”的组合。控制面关心状态一致、调度和 HA；数据面关心虚机性能、网络转发、存储时延和失败恢复。

## 2. OpenStack 到底是什么

从抽象层看，OpenStack 提供 4 类能力：

1. 多租户资源抽象：实例、网络、子网、路由器、卷、镜像、浮动 IP、配额、项目、域。
2. 统一控制面：REST API、认证授权、服务发现、状态管理、调度。
3. 可插拔驱动：hypervisor、网络机制驱动、存储后端、身份联邦、LB、裸金属。
4. 自动化运营基础：高可用、监控、日志、升级、备份、容量规划、故障域隔离。

你可以把它理解成一层“云资源编排操作系统”：

- 上层面对用户暴露 API、CLI、Horizon、Terraform/SDK。
- 中间层做认证、配额、调度、状态写入、异步任务分发。
- 下层通过 libvirt、OVS/OVN、存储驱动、Ceph/FC/iSCSI/NFS 等落到真实资源。

## 3. 核心架构原理

### 3.1 总体架构图

<div class="diagram-card">
  <svg viewBox="0 0 1220 700" role="img" aria-labelledby="arch-title arch-desc">
    <title id="arch-title">OpenStack 核心架构总览</title>
    <desc id="arch-desc">展示用户入口、控制平面、调度与状态、计算节点、网络节点和存储后端之间的关系。</desc>
    <defs>
      <linearGradient id="panelA" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fff8ef" />
        <stop offset="100%" stop-color="#fdeef3" />
      </linearGradient>
      <linearGradient id="panelB" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#eef7ff" />
        <stop offset="100%" stop-color="#eef4ff" />
      </linearGradient>
      <linearGradient id="panelC" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#edfbf7" />
        <stop offset="100%" stop-color="#eef8f0" />
      </linearGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#7c6adb"></path>
      </marker>
    </defs>

    <rect x="20" y="20" width="1180" height="660" rx="28" fill="#fffdf9" stroke="#e6ddcf" stroke-width="2"></rect>

    <rect x="50" y="50" width="1120" height="110" rx="24" fill="url(#panelA)" stroke="#e6c3d2" stroke-width="2"></rect>
    <rect x="80" y="82" width="220" height="48" rx="18" fill="#ffffff" stroke="#d97896" stroke-width="2"></rect>
    <text x="190" y="112" text-anchor="middle" font-size="24" font-weight="700" fill="#8f2f5d">用户 / CLI / SDK / Terraform</text>
    <rect x="360" y="82" width="260" height="48" rx="18" fill="#ffffff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="490" y="112" text-anchor="middle" font-size="24" font-weight="700" fill="#5640b1">HAProxy / Keepalived / VIP</text>
    <rect x="690" y="82" width="440" height="48" rx="18" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="910" y="112" text-anchor="middle" font-size="24" font-weight="700" fill="#2d6f8d">Horizon / OpenStack API Endpoints</text>

    <rect x="50" y="190" width="1120" height="220" rx="24" fill="url(#panelB)" stroke="#b8cfee" stroke-width="2"></rect>
    <text x="88" y="228" font-size="28" font-weight="800" fill="#345a9d">控制平面 Control Plane</text>

    <rect x="82" y="250" width="170" height="62" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="167" y="286" text-anchor="middle" font-size="23" font-weight="700" fill="#5c48bd">Keystone</text>
    <text x="167" y="307" text-anchor="middle" font-size="15" fill="#6c6791">认证 / Token / Catalog</text>

    <rect x="278" y="250" width="170" height="62" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="363" y="286" text-anchor="middle" font-size="23" font-weight="700" fill="#5c48bd">Nova API</text>
    <text x="363" y="307" text-anchor="middle" font-size="15" fill="#6c6791">实例生命周期入口</text>

    <rect x="474" y="250" width="170" height="62" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="559" y="286" text-anchor="middle" font-size="23" font-weight="700" fill="#5c48bd">Neutron</text>
    <text x="559" y="307" text-anchor="middle" font-size="15" fill="#6c6791">网络模型 / IPAM / Port</text>

    <rect x="670" y="250" width="170" height="62" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="755" y="286" text-anchor="middle" font-size="23" font-weight="700" fill="#5c48bd">Cinder / Glance</text>
    <text x="755" y="307" text-anchor="middle" font-size="15" fill="#6c6791">卷 / 镜像 / 快照</text>

    <rect x="866" y="250" width="240" height="62" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="986" y="286" text-anchor="middle" font-size="23" font-weight="700" fill="#5c48bd">Placement / Octavia / Heat</text>
    <text x="986" y="307" text-anchor="middle" font-size="15" fill="#6c6791">资源视图 / LB / 编排</text>

    <rect x="130" y="335" width="180" height="52" rx="16" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="220" y="367" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">RabbitMQ</text>
    <text x="220" y="385" text-anchor="middle" font-size="14" fill="#5c7089">异步任务总线</text>

    <rect x="350" y="335" width="220" height="52" rx="16" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="460" y="367" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">MariaDB / Galera</text>
    <text x="460" y="385" text-anchor="middle" font-size="14" fill="#5c7089">状态、配额、映射关系</text>

    <rect x="610" y="335" width="200" height="52" rx="16" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="710" y="367" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Memcached</text>
    <text x="710" y="385" text-anchor="middle" font-size="14" fill="#5c7089">Token / 缓存</text>

    <rect x="850" y="335" width="210" height="52" rx="16" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="955" y="367" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Nova Cells v2</text>
    <text x="955" y="385" text-anchor="middle" font-size="14" fill="#5c7089">cell0 / cell1 / 多 cell</text>

    <rect x="50" y="440" width="1120" height="210" rx="24" fill="url(#panelC)" stroke="#bde2d5" stroke-width="2"></rect>
    <text x="88" y="478" font-size="28" font-weight="800" fill="#246d59">数据平面 Data Plane</text>

    <rect x="82" y="504" width="300" height="112" rx="18" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="232" y="538" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">Compute Node</text>
    <text x="232" y="565" text-anchor="middle" font-size="16" fill="#4f766b">nova-compute / libvirt / qemu-kvm</text>
    <text x="232" y="590" text-anchor="middle" font-size="16" fill="#4f766b">virtio / NUMA / hugepage / SR-IOV</text>

    <rect x="420" y="504" width="330" height="112" rx="18" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="585" y="538" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">Network Path</text>
    <text x="585" y="565" text-anchor="middle" font-size="16" fill="#4f766b">OVS / OVN / bridge / VXLAN / GENEVE</text>
    <text x="585" y="590" text-anchor="middle" font-size="16" fill="#4f766b">security group / NAT / floating IP / metadata</text>

    <rect x="788" y="504" width="350" height="112" rx="18" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="963" y="538" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">Storage Backend</text>
    <text x="963" y="565" text-anchor="middle" font-size="16" fill="#4f766b">Ceph RBD / FC / iSCSI / NFS / LVM / Swift</text>
    <text x="963" y="590" text-anchor="middle" font-size="16" fill="#4f766b">镜像拉取、卷挂载、快照、备份、复制</text>

    <line x1="300" y1="106" x2="360" y2="106" stroke="#7c6adb" stroke-width="4" marker-end="url(#arrow)"></line>
    <line x1="620" y1="106" x2="690" y2="106" stroke="#7c6adb" stroke-width="4" marker-end="url(#arrow)"></line>

    <line x1="363" y1="312" x2="220" y2="335" stroke="#7c6adb" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="363" y1="312" x2="460" y2="335" stroke="#7c6adb" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="559" y1="312" x2="220" y2="335" stroke="#7c6adb" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="755" y1="312" x2="460" y2="335" stroke="#7c6adb" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="986" y1="312" x2="955" y2="335" stroke="#7c6adb" stroke-width="3" marker-end="url(#arrow)"></line>

    <line x1="955" y1="387" x2="232" y2="504" stroke="#2aa17d" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="559" y1="387" x2="585" y2="504" stroke="#2aa17d" stroke-width="3" marker-end="url(#arrow)"></line>
    <line x1="755" y1="387" x2="963" y2="504" stroke="#2aa17d" stroke-width="3" marker-end="url(#arrow)"></line>
  </svg>
  <p class="diagram-caption">看这张图时记住两个词：<strong>状态</strong> 和 <strong>流量</strong>。状态主要存在数据库、消息队列、Placement、Keystone key、Neutron/Nova/Cinder 的资源映射里；真实流量则走虚机、虚拟交换机、隧道、存储后端和外部网络。</p>
</div>

### 3.2 控制平面和数据平面为什么一定要分开

控制平面负责：

1. API 接入、认证授权、配额检查。
2. 资源建模和状态持久化。
3. 调度决策和异步编排。
4. 对底层驱动下发任务并跟踪结果。

数据平面负责：

1. 虚机真正启动和停止。
2. vNIC 的接入、VXLAN 或 GENEVE 封装、NAT 和 ACL。
3. 卷挂载、镜像缓存、块数据读写。
4. 实际南北向和东西向流量转发。

面试官如果追问“为什么要分开”，你就答：

> 因为 API 的一致性和虚机流量的性能目标完全不同。控制面可以接受更多事务逻辑和重试，但数据面更怕抖动、尾时延和丢包。把两者混在一起，最终会同时失去稳定性和性能。

### 3.3 一台虚机是怎么被创建出来的

最常考的不是组件介绍，而是 `boot instance` 全链路。

<div class="diagram-card">
  <svg viewBox="0 0 1220 420" role="img" aria-labelledby="boot-title boot-desc">
    <title id="boot-title">OpenStack 创建实例主路径</title>
    <desc id="boot-desc">从用户发起创建实例请求，到 Nova 调度、Neutron 端口绑定、Cinder 挂卷、Glance 拉镜像，再到 libvirt 拉起虚机。</desc>
    <defs>
      <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#5c48bd"></path>
      </marker>
    </defs>
    <rect x="20" y="20" width="1180" height="380" rx="28" fill="#fffdf8" stroke="#eadfce" stroke-width="2"></rect>

    <rect x="50" y="80" width="130" height="68" rx="18" fill="#fff" stroke="#d97896" stroke-width="2"></rect>
    <text x="115" y="118" text-anchor="middle" font-size="22" font-weight="700" fill="#913960">Client</text>

    <rect x="220" y="80" width="150" height="68" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="295" y="110" text-anchor="middle" font-size="22" font-weight="700" fill="#5843b7">Nova API</text>
    <text x="295" y="132" text-anchor="middle" font-size="14" fill="#6f6a95">auth / request</text>

    <rect x="410" y="80" width="150" height="68" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="485" y="110" text-anchor="middle" font-size="22" font-weight="700" fill="#5843b7">Placement</text>
    <text x="485" y="132" text-anchor="middle" font-size="14" fill="#6f6a95">inventory / traits</text>

    <rect x="600" y="80" width="170" height="68" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="685" y="110" text-anchor="middle" font-size="22" font-weight="700" fill="#5843b7">Nova Scheduler</text>
    <text x="685" y="132" text-anchor="middle" font-size="14" fill="#6f6a95">select host</text>

    <rect x="810" y="80" width="160" height="68" rx="18" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="890" y="110" text-anchor="middle" font-size="22" font-weight="700" fill="#5843b7">Nova Conductor</text>
    <text x="890" y="132" text-anchor="middle" font-size="14" fill="#6f6a95">state orchestration</text>

    <rect x="1010" y="80" width="160" height="68" rx="18" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="1090" y="110" text-anchor="middle" font-size="22" font-weight="700" fill="#216f58">nova-compute</text>
    <text x="1090" y="132" text-anchor="middle" font-size="14" fill="#51786d">libvirt / qemu</text>

    <rect x="320" y="250" width="170" height="64" rx="18" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="405" y="286" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Neutron</text>
    <text x="405" y="306" text-anchor="middle" font-size="14" fill="#5c7089">port / SG / binding</text>

    <rect x="540" y="250" width="170" height="64" rx="18" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="625" y="286" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Glance</text>
    <text x="625" y="306" text-anchor="middle" font-size="14" fill="#5c7089">image metadata</text>

    <rect x="760" y="250" width="170" height="64" rx="18" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="845" y="286" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Cinder</text>
    <text x="845" y="306" text-anchor="middle" font-size="14" fill="#5c7089">boot from volume</text>

    <rect x="980" y="250" width="170" height="64" rx="18" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="1065" y="286" text-anchor="middle" font-size="22" font-weight="700" fill="#2f6f8d">Storage</text>
    <text x="1065" y="306" text-anchor="middle" font-size="14" fill="#5c7089">Ceph / NFS / SAN</text>

    <line x1="180" y1="114" x2="220" y2="114" stroke="#5c48bd" stroke-width="4" marker-end="url(#arrow2)"></line>
    <line x1="370" y1="114" x2="410" y2="114" stroke="#5c48bd" stroke-width="4" marker-end="url(#arrow2)"></line>
    <line x1="560" y1="114" x2="600" y2="114" stroke="#5c48bd" stroke-width="4" marker-end="url(#arrow2)"></line>
    <line x1="770" y1="114" x2="810" y2="114" stroke="#5c48bd" stroke-width="4" marker-end="url(#arrow2)"></line>
    <line x1="970" y1="114" x2="1010" y2="114" stroke="#5c48bd" stroke-width="4" marker-end="url(#arrow2)"></line>

    <line x1="885" y1="148" x2="405" y2="250" stroke="#5c48bd" stroke-width="3" marker-end="url(#arrow2)"></line>
    <line x1="1090" y1="148" x2="625" y2="250" stroke="#5c48bd" stroke-width="3" marker-end="url(#arrow2)"></line>
    <line x1="1090" y1="148" x2="845" y2="250" stroke="#5c48bd" stroke-width="3" marker-end="url(#arrow2)"></line>
    <line x1="930" y1="282" x2="980" y2="282" stroke="#5c48bd" stroke-width="3" marker-end="url(#arrow2)"></line>
  </svg>
  <p class="diagram-caption">主链路可以压成 8 个动作：<strong>认证</strong>、<strong>参数校验</strong>、<strong>资源视图查询</strong>、<strong>主机调度</strong>、<strong>端口准备</strong>、<strong>镜像或卷准备</strong>、<strong>libvirt 启动</strong>、<strong>状态回写</strong>。</p>
</div>

完整过程通常是：

1. 用户请求到 `nova-api`，先通过 Keystone 校验 token。
2. Nova 查询配额、镜像、Flavor、可用区、网络和卷信息。
3. Scheduler 根据 Placement 的资源视图、traits、aggregates、NUMA/SR-IOV 等条件选主机。
4. Conductor 负责在控制面编排，向目标 cell / compute 下发任务。
5. Compute 节点向 Neutron 申请端口绑定，准备 tap、bridge、security group。
6. 如果是镜像启动，Compute 从 Glance 拉镜像，通常会落到本地缓存或后端存储。
7. 如果是卷启动，Cinder 把块设备映射到目标宿主机。
8. libvirt 生成 domain XML，qemu-kvm 启动虚机，状态写回数据库。

一句面试总结：

> Nova 自己不直接管网络和磁盘数据，它更像一个总调度器，把“算、网、存”串起来。

## 4. 组件原理，一次讲透

### 4.1 Keystone：为什么说它不只是“登录服务”

Keystone 负责 3 件事：

1. 认证：用户、服务、联邦身份、应用凭证。
2. 授权：domain、project、role、policy。
3. 服务目录：告诉客户端每个服务的 endpoint 在哪里。

核心概念：

1. `Domain` 是身份管理边界。
2. `Project` 是租户和资源隔离边界。
3. `Role + policy` 决定一个请求到底能不能做。
4. `Service catalog` 让客户端拿 token 后知道应该去访问哪个 API 地址。

面试高频点：

1. Fernet token 为什么常用。
   原因是 token 不需要持久化写库，长度更小，验证成本低。
2. 多节点 Keystone 最大坑是什么。
   不是 endpoint，而是 `fernet key` 分发和轮换必须严格同步。
3. Keystone 挂了会怎样。
   老 token 可能还能在部分链路继续用，但新认证、服务发现、很多控制面操作会大量失败。

要点记忆：

> Keystone 是“认证 + 授权 + 服务目录”，不是“数据库里查个用户名密码”那么简单。

### 4.2 Nova：计算服务的本质是状态机

Nova 不是 hypervisor 本身，Nova 是计算控制面。它真正协调的是：

1. 实例期望状态和实际状态。
2. 调度约束和资源视图。
3. cell 内消息路由和故障隔离。
4. libvirt / Hyper-V / VMware 等底层驱动调用。

你要能讲清几个角色：

1. `nova-api`：接请求。
2. `nova-scheduler`：挑主机。
3. `nova-conductor`：避免 compute 直接写数据库，承担控制面编排。
4. `nova-compute`：真正跟 hypervisor 打交道。
5. `placement-api`：资源库存、traits、allocations 的事实来源。
6. `cells v2`：把大规模部署按 cell 切开，降低数据库和消息风暴。

Cells v2 的本质：

1. 把计算节点按 cell 分片。
2. API 层面维持全局入口。
3. 每个 cell 有自己的消息和数据库边界。
4. `cell0` 专门放调度失败、无法创建成功的实例记录。

一句拿分的话：

> Nova 的扩展性核心不只是多台 compute，而是 `cells v2 + placement + conductor` 这套状态分片和编排机制。

### 4.3 Neutron：最容易被问炸的一层

Neutron 管的是“网络意图”，不直接等于“交换机配置”。

它负责：

1. Network / Subnet / Port / Router / Floating IP 模型。
2. IPAM 和 DHCP。
3. Security Group、ACL、QoS。
4. 二层接入、三层路由、NAT、metadata 接入。
5. 通过 ML2 和机制驱动把抽象模型落到 OVS、OVN、SR-IOV 等实现。

你要分清两层：

1. Neutron server：控制面，负责资源模型和状态。
2. Agent 或 OVN controller：数据面，把配置变成真实转发规则。

常见实现路线：

1. `ML2 + OVS`：传统而经典，常见 bridge 是 `br-int`、`br-tun`、`br-ex`。
2. `ML2 + OVN`：把二三层逻辑下沉到 OVN，控制模型更统一，新建云里很常见。

面试一定要说：

> Neutron 真正难的不是建一个网络，而是要在多宿主机、多租户、overlay、浮动 IP、ACL 和 MTU 这些限制下，保证连通性、隔离性和可运维性。

### 4.4 Cinder：块存储控制面，不是“磁盘本体”

Cinder 负责：

1. 卷、快照、备份、类型、QoS、复制策略。
2. 调度到具体后端。
3. 通过 driver 跟 Ceph、FC、iSCSI、NFS、LVM 等交互。
4. 控制 attach / detach / extend / retype / migrate。

关键角色：

1. `cinder-api`
2. `cinder-scheduler`
3. `cinder-volume`
4. `cinder-backup`

要点：

1. Cinder 自己不是存储介质，而是存储编排层。
2. 真正数据落在哪，要看后端 driver。
3. 卷的高可用不由 Cinder 自动保证，本质上取决于后端存储的能力。

### 4.5 Glance：镜像元数据和分发中心

Glance 负责：

1. 镜像元数据、格式、可见性、校验。
2. 镜像存储后端接入。
3. 镜像分发给 compute。

面试时要补一句：

> Glance 的瓶颈不一定是 API，而经常是镜像后端吞吐、本地缓存策略、镜像格式转换和大规模并发拉取。

### 4.6 Placement：为什么 `No valid host` 常常要先看它

Placement 维护的是资源提供者视图：

1. vCPU、MEMORY_MB、DISK_GB。
2. PCI、SR-IOV VF、NUMA、hugepage 等 trait。
3. aggregates、allocations、inventories。

调度失败往往不是 compute 真的死了，而是：

1. Placement 视图不正确。
2. trait / aggregate 不匹配。
3. reserved、allocation_ratio、inventory 没配好。

一句话：

> Placement 不是“附属组件”，它是 Nova 调度的资源真相来源。

### 4.7 其他组件，面试官爱追问什么

`Horizon`

1. Web 控制台。
2. 常被误以为是核心，其实它只是 UI，不是底层控制逻辑。

`Heat`

1. OpenStack 的编排服务。
2. 面试可类比成“原生的基础设施模板编排层”。

`Octavia`

1. 负载均衡服务。
2. 背后常通过 amphora VM 或 provider driver 实现。

`Barbican`

1. 密钥和证书管理。
2. 适合讲 TLS 私钥、卷加密、服务端证书。

`Ironic`

1. 裸金属即服务。
2. 如果面试官问“OpenStack 能不能管物理机”，这就是答案。

## 5. 备份原理与容灾原理

### 5.1 先把概念分清：快照、备份、复制不是一回事

| 能力 | 本质 | 典型用途 | 风险 |
| --- | --- | --- | --- |
| 快照 Snapshot | 某一时刻的逻辑一致性点 | 快速回滚、制作模板、短期保护 | 通常依赖同一后端，后端故障可能一起丢 |
| 备份 Backup | 把数据导出到另一份可恢复介质 | 长期保存、跨故障域恢复 | 恢复时间可能长 |
| 复制 Replication | 持续把数据同步或异步到另一位置 | 容灾、高可用、异地恢复 | 成本高，对带宽和一致性要求高 |

面试官如果问“卷快照能不能当备份”，正确答案是：

> 可以作为备份链路的一环，但不能把同一存储池里的快照当成完整备份，因为它没有真正脱离原故障域。

### 5.2 OpenStack 该备份什么

真正需要备份的是 4 层：

1. 控制面状态：
   MariaDB / Galera 数据库、RabbitMQ definitions、Keystone Fernet keys、配置文件、证书、OVN NB/SB DB、Placement 数据。
2. 镜像层：
   Glance 镜像和元数据。
3. 数据卷层：
   Cinder 卷、快照、备份记录，以及底层 Ceph/SAN/NFS 的真实数据。
4. 业务层：
   虚机内应用数据、数据库、配置、日志。

面试加分点：

> OpenStack 备份不是只备一个数据库。控制面恢复只能让云“知道资源还在”，不代表租户数据真的可恢复。

### 5.3 Cinder 备份原理

<div class="diagram-card">
  <svg viewBox="0 0 1220 430" role="img" aria-labelledby="backup-title backup-desc">
    <title id="backup-title">Cinder 备份链路</title>
    <desc id="backup-desc">卷数据从存储后端经过快照或读取，被 cinder-backup 写入 Swift、Ceph 或其他备份目标。</desc>
    <defs>
      <marker id="arrow3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f7c61"></path>
      </marker>
    </defs>
    <rect x="20" y="20" width="1180" height="390" rx="28" fill="#fffefa" stroke="#e7dccb" stroke-width="2"></rect>

    <rect x="60" y="150" width="220" height="96" rx="20" fill="#ffffff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="170" y="188" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">Volume</text>
    <text x="170" y="214" text-anchor="middle" font-size="16" fill="#56786c">运行中的卷 / 数据块</text>

    <rect x="340" y="80" width="220" height="96" rx="20" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="450" y="118" text-anchor="middle" font-size="24" font-weight="700" fill="#2f6f8d">Snapshot</text>
    <text x="450" y="144" text-anchor="middle" font-size="16" fill="#567086">一致性点 / changed blocks</text>

    <rect x="340" y="220" width="220" height="96" rx="20" fill="#ffffff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="450" y="258" text-anchor="middle" font-size="24" font-weight="700" fill="#2f6f8d">cinder-backup</text>
    <text x="450" y="284" text-anchor="middle" font-size="16" fill="#567086">chunk / compress / stream</text>

    <rect x="630" y="150" width="240" height="96" rx="20" fill="#ffffff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="750" y="188" text-anchor="middle" font-size="24" font-weight="700" fill="#5c48bd">Backup Backend</text>
    <text x="750" y="214" text-anchor="middle" font-size="16" fill="#67638d">Swift / Ceph / NFS / Posix</text>

    <rect x="940" y="80" width="220" height="96" rx="20" fill="#ffffff" stroke="#d97896" stroke-width="2"></rect>
    <text x="1050" y="118" text-anchor="middle" font-size="24" font-weight="700" fill="#913960">Metadata</text>
    <text x="1050" y="144" text-anchor="middle" font-size="16" fill="#84657b">DB 记录 backup chain</text>

    <rect x="940" y="220" width="220" height="96" rx="20" fill="#ffffff" stroke="#d97896" stroke-width="2"></rect>
    <text x="1050" y="258" text-anchor="middle" font-size="24" font-weight="700" fill="#913960">Restore</text>
    <text x="1050" y="284" text-anchor="middle" font-size="16" fill="#84657b">写回新卷或原卷</text>

    <line x1="280" y1="198" x2="340" y2="128" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
    <line x1="280" y1="198" x2="340" y2="268" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
    <line x1="560" y1="128" x2="630" y2="198" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
    <line x1="560" y1="268" x2="630" y2="198" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
    <line x1="870" y1="198" x2="940" y2="128" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
    <line x1="870" y1="198" x2="940" y2="268" stroke="#1f7c61" stroke-width="4" marker-end="url(#arrow3)"></line>
  </svg>
  <p class="diagram-caption">Cinder 备份的控制逻辑在 <strong>cinder-backup</strong>，但备份性能和可恢复性高度依赖底层后端能力。面试时一定区分“控制面备份对象”和“真实数据所在故障域”。</p>
</div>

你可以这样讲原理：

1. 对卷做备份时，Cinder 会读取卷或快照的数据块。
2. `cinder-backup` 把数据按 chunk 处理，可做压缩和增量。
3. 数据被写入备份后端，例如 Swift、Ceph、NFS、Posix 等。
4. 数据库里会记录备份链和元数据。
5. 恢复时再从备份后端读回，写到新卷或目标卷。

面试官可能追问的细节：

1. 增量备份的基础是什么。
   本质是“和前一次备份相比，哪些块变了”，不同后端能力差异很大。
2. 为什么备份很慢。
   因为它不是单纯元数据复制，而是真实块数据扫描、压缩、网络传输、后端写入。
3. 为什么恢复会吃很多内存和 CPU。
   因为 chunk 解压、缓冲和写回都占资源，并发恢复时会明显放大。

### 5.4 控制面恢复顺序

如果整个控制面故障，恢复顺序最好按依赖来：

1. 基础系统：DNS、NTP、VIP、证书、操作系统、容器运行时。
2. 数据层：MariaDB / Galera、RabbitMQ、Memcached。
3. 身份层：Keystone 配置和 Fernet keys。
4. 核心 API：Nova、Neutron、Cinder、Glance、Placement。
5. 网络控制：OVN NB/SB 或 Neutron agents。
6. 再接入 compute、storage、LB、编排等外围服务。

这里最容易忽视的点：

1. `fernet-keys` 丢了，旧 token 全部失效，服务之间也可能互相认证失败。
2. 数据库恢复了但 MQ definitions 没恢复，服务看起来在线，任务却发不出去。
3. 只恢复 OpenStack 数据库，不恢复 Ceph 或 SAN 元数据，卷记录存在但数据不可读。

### 5.5 面试标准答法：如何做 OpenStack 容灾

推荐答法：

> OpenStack 容灾至少分三层。第一层是控制面 HA，解决单点故障；第二层是控制面备份恢复，解决误删、集群损坏和大面积故障；第三层是租户数据容灾，通常依赖 Cinder 后端复制、Ceph 跨站点、应用层主从或数据库同步。OpenStack 本身只解决一部分，真正的 RPO/RTO 要结合后端存储和业务架构一起设计。

## 6. 网络原理，面试最爱挖的坑

### 6.1 四张网络最好一开始就分好

生产私有云里，最少建议清楚分离这几类网络：

1. 管理网络：
   API、SSH、数据库、消息队列、控制面服务之间通信。
2. 租户 overlay 网络：
   VXLAN 或 GENEVE 封装的东西向虚拟网络流量。
3. 存储网络：
   Ceph、iSCSI、NFS、FC 管理和数据访问。
4. 外部或 provider 网络：
   浮动 IP、SNAT、对外服务出口。
5. 可选 OOB 网络：
   BMC、IPMI、交换机管理口。

为什么一定要分：

1. 避免控制面和大流量数据面互相打爆。
2. 便于做 ACL、QoS 和故障隔离。
3. MTU、路由和安全策略可以分层治理。

### 6.2 Provider network 和 self-service network 的区别

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Provider Network | 虚机直接桥接到物理 VLAN / flat 网络 | 简单、性能好、调试直观 | 租户自治弱、网络灵活性差 | 传统企业网络、少租户、固定规划 |
| Self-service Network | 用 VXLAN / GENEVE 等 overlay 构建租户网络，再经路由器到外网 | 多租户隔离强、租户可自助建网 | MTU、排障和控制面更复杂 | 标准私有云、多租户云平台 |

一条记忆线：

> Provider 更像“把虚机接到现网”；Self-service 更像“先在云里造一张逻辑网，再决定怎么出云”。

### 6.3 一包流量到底怎么走

<div class="diagram-card">
  <svg viewBox="0 0 1220 500" role="img" aria-labelledby="net-title net-desc">
    <title id="net-title">Neutron 数据路径示意图</title>
    <desc id="net-desc">展示虚机 vNIC 进入 OVS/OVN 数据路径，经 overlay 到另一台宿主机或通过路由器到外部网络。</desc>
    <defs>
      <marker id="arrow4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6f8d"></path>
      </marker>
    </defs>
    <rect x="20" y="20" width="1180" height="460" rx="28" fill="#fffefa" stroke="#e5ddcf" stroke-width="2"></rect>

    <rect x="60" y="130" width="220" height="90" rx="20" fill="#fff" stroke="#7c6adb" stroke-width="2"></rect>
    <text x="170" y="168" text-anchor="middle" font-size="24" font-weight="700" fill="#5c48bd">VM A</text>
    <text x="170" y="194" text-anchor="middle" font-size="16" fill="#6f6a95">tap / vNIC / SG</text>

    <rect x="340" y="70" width="240" height="90" rx="20" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="460" y="108" text-anchor="middle" font-size="24" font-weight="700" fill="#2f6f8d">br-int / OVN LS</text>
    <text x="460" y="134" text-anchor="middle" font-size="16" fill="#5d7088">port binding / ACL</text>

    <rect x="340" y="200" width="240" height="90" rx="20" fill="#fff" stroke="#5ba8c8" stroke-width="2"></rect>
    <text x="460" y="238" text-anchor="middle" font-size="24" font-weight="700" fill="#2f6f8d">br-tun / Geneve</text>
    <text x="460" y="264" text-anchor="middle" font-size="16" fill="#5d7088">overlay encapsulation</text>

    <rect x="640" y="140" width="240" height="90" rx="20" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="760" y="178" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">宿主机 B</text>
    <text x="760" y="204" text-anchor="middle" font-size="16" fill="#55786c">decap / remote port</text>

    <rect x="940" y="70" width="220" height="90" rx="20" fill="#fff" stroke="#d97896" stroke-width="2"></rect>
    <text x="1050" y="108" text-anchor="middle" font-size="24" font-weight="700" fill="#913960">VM B</text>
    <text x="1050" y="134" text-anchor="middle" font-size="16" fill="#84657b">东西向通信</text>

    <rect x="940" y="230" width="220" height="90" rx="20" fill="#fff" stroke="#d97896" stroke-width="2"></rect>
    <text x="1050" y="268" text-anchor="middle" font-size="24" font-weight="700" fill="#913960">Router / br-ex</text>
    <text x="1050" y="294" text-anchor="middle" font-size="16" fill="#84657b">SNAT / FIP / 外网</text>

    <rect x="640" y="330" width="240" height="90" rx="20" fill="#fff" stroke="#5db89a" stroke-width="2"></rect>
    <text x="760" y="368" text-anchor="middle" font-size="24" font-weight="700" fill="#1f7c61">Metadata / DHCP</text>
    <text x="760" y="394" text-anchor="middle" font-size="16" fill="#55786c">169.254.169.254 / IP 分配</text>

    <line x1="280" y1="175" x2="340" y2="115" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
    <line x1="280" y1="175" x2="340" y2="245" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
    <line x1="580" y1="245" x2="640" y2="185" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
    <line x1="880" y1="185" x2="940" y2="115" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
    <line x1="760" y1="230" x2="760" y2="330" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
    <line x1="880" y1="185" x2="940" y2="275" stroke="#2f6f8d" stroke-width="4" marker-end="url(#arrow4)"></line>
  </svg>
  <p class="diagram-caption">东西向走 overlay，南北向通常经过 router namespace、分布式路由或网关节点，再经 <strong>br-ex</strong> 或 provider 接口出云。排障时先判断问题在 <strong>L2 接入</strong>、<strong>overlay 封装</strong>、<strong>L3/NAT</strong>，还是在 <strong>security group / metadata</strong>。</p>
</div>

#### 东西向流量

1. 虚机包从 tap 进入。
2. 经过安全组规则、端口绑定规则。
3. 在本地主机上被 OVS 或 OVN pipeline 处理。
4. 如果目标在另一台宿主机，做 VXLAN/GENEVE 封装后发往对端。
5. 对端解封装，再送到目标虚机。

#### 南北向流量

1. 包进入虚拟路由器。
2. 经过 DNAT/SNAT 或 Floating IP。
3. 从 provider 网络或外部 bridge 发到物理网络。
4. 回程如果路由、MTU、conntrack 或安全组有问题，就会出现“能 ping 网关不能上网”这类症状。

### 6.4 网络最容易翻车的 8 个点

1. `MTU` 没算 overlay 头开销。
   结果是小包通、大包丢，最难排。
2. `bridge_mappings` 或 physnet 对不上。
   端口绑定能建，实际不出流量。
3. Tenant 网络和 provider 网络的路由边界没规划。
4. 外部网络 VLAN trunk 没在交换机放通。
5. Metadata 代理或 169.254.169.254 路由链路断。
6. 安全组规则只放了 ingress，忘了 egress 或 stateful conntrack。
7. 存储网络和 overlay 混跑，Ceph 或 iSCSI 抢占带宽。
8. 交换机 ECMP、LACP、MLAG、VXLAN offload 和宿主机设置不匹配。

## 7. 常见报错、故障现象和排查方法

### 7.1 一套通用排障顺序

先不要上来就看一堆日志，按顺序排：

1. 看请求在哪一层失败：
   API 层、调度层、网络层、存储层、hypervisor 层。
2. 看资源状态有没有闭环：
   实例、port、volume、allocation、backup、snapshot 是否状态一致。
3. 看依赖组件是否健康：
   Keystone、RabbitMQ、MariaDB、Placement、OVN/OVS、Ceph。
4. 看宿主机本地实际状态：
   bridge、namespace、tap、iptables/nft、libvirt domain、块设备映射。
5. 最后才是看单个服务日志细节。

### 7.2 面试里最常出现的报错矩阵

| 现象 / 报错 | 最可能的根因 | 你应该先看什么 |
| --- | --- | --- |
| `No valid host was found` | Placement 库存不对、trait 不匹配、聚合或 AZ 约束冲突 | Placement allocations、resource provider、Flavor extra specs |
| `Exceeded maximum number of retries. Exhausted all hosts available` | 不是单纯调度失败，而是调到主机后在网络、镜像、卷、libvirt 环节连续失败 | `nova-conductor`、`nova-compute`、底层 attach 错误 |
| `PortBindingFailed` / 端口创建成功但实例起不来 | ML2/OVS/OVN 绑定失败、physnet 错、agent down | Neutron server、agent 状态、bridge 和映射 |
| 实例创建成功但拿不到 IP | DHCP agent / metadata / 子网配置问题 | DHCP namespace、port 状态、subnet 和 security group |
| 实例能 ping 内网不能上外网 | SNAT/FIP 链路、路由、MTU 或外部交换机 trunk | router、br-ex、外部网络、NAT 规则 |
| `AMQP server ... is unreachable` | RabbitMQ 不通、用户权限错、集群异常 | Rabbit 状态、队列、vhost、网络连通性 |
| `WSREP has not yet prepared node for application use` | Galera 节点不在 Primary 或未同步 | Galera 集群状态、仲裁、磁盘空间、延迟 |
| 卷卡在 `attaching` / `detaching` | 后端存储未完成映射、nova/cinder 状态不一致 | `cinder-volume`、`nova-compute`、后端 LUN/RBD 状态 |
| 备份卡在 `creating` / `restoring` | cinder-backup、RabbitMQ、数据库或后端备份介质异常 | `cinder-backup.log`、后端对象存储、任务状态 |
| token 偶发失效、跨控制节点认证失败 | Keystone Fernet keys 分发不一致 | 各节点 `/etc/keystone/fernet-keys/` 是否一致 |
| 虚机启动后控制台黑屏 | 镜像驱动、virtio、libvirt XML、CPU 模型不兼容 | `nova-compute`、libvirt、镜像格式 |
| Live migration 失败 | CPU 特性不兼容、共享存储或 block migration 条件不满足、网络不通 | libvirt 迁移日志、CPU flags、目标宿主机存储与网络 |

### 7.3 典型报错场景怎么讲，最容易拿分

#### 场景 1：`No valid host was found`

这类题不要答“资源不够”就结束。

正确展开方式：

1. 先看 Placement 里 compute 是否正常上报 inventory。
2. 再看 flavor 是否要求特定 trait、NUMA、hugepage、PCI 设备。
3. 看 host aggregate、AZ、server group affinity/anti-affinity 是否把候选主机排空了。
4. 看宿主机虽然在线，但 `reserved_host_memory_mb`、allocation ratio、磁盘库存是否过紧。

一句话：

> 这是“调度约束和资源视图不匹配”的题，不是“主机宕机”的题。

#### 场景 2：网络全都建好了，但虚机不通

优先级应该是：

1. 端口状态是不是 `ACTIVE`。
2. 虚机宿主机上 tap 是否接到了正确 bridge。
3. Overlay 隧道是否通，MTU 是否一致。
4. 安全组和 port security 是否拦截。
5. 路由器 namespace、SNAT/FIP 是否正确。

最容易拿分的补充：

> 先判断是单宿主机还是跨宿主机问题。如果单机通、跨机不通，优先怀疑 overlay 和 MTU；如果内网通、外网不通，优先怀疑路由和 NAT；如果 metadata 不通，优先看 metadata agent 和 namespace 链路。

#### 场景 3：多控制节点偶发 401 或服务互相认证失败

高概率是：

1. Keystone endpoint 不一致。
2. Fernet key 未同步。
3. 时钟漂移导致 token 校验失败。
4. Service user 的密码、application credential 或 policy 配置不一致。

这里面最经典的坑就是：

> 某个节点先做了 Fernet rotate，但新 key 没有立刻分发，导致这个节点发出的 token 其他节点验不过。

### 7.4 关键日志位置要背住

常见位置：

1. `/var/log/nova/nova-api.log`
2. `/var/log/nova/nova-scheduler.log`
3. `/var/log/nova/nova-conductor.log`
4. `/var/log/nova/nova-compute.log`
5. `/var/log/neutron/server.log`
6. `/var/log/cinder/cinder-volume.log`
7. `/var/log/cinder/cinder-backup.log`
8. `/var/log/httpd/` 或 Keystone 服务日志
9. `journalctl -u libvirtd` 或 `virtqemud`
10. OVS / OVN 自身日志和数据库状态

面试时不要报一堆路径，点到为止即可：

> 控制面看 API、scheduler、conductor；数据面看 compute、libvirt、OVS/OVN、后端存储。

## 8. 私有云搭建过程中，最该注意什么

### 8.1 先做架构设计，不要先装服务

开工前必须回答这些问题：

1. 多租户强不强。
   决定你是偏 provider network 还是 self-service overlay。
2. 规模多大。
   决定是否一开始就规划 `cells v2`、分区机房、专用网络节点、独立存储网络。
3. 负载是什么。
   普通业务 VM、数据库、GPU、NFV、VDI，对 CPU、NUMA、SR-IOV、存储模型要求都不同。
4. HA 目标和 RPO/RTO 是多少。
   决定是只做控制面 HA，还是要跨站复制和业务级容灾。

### 8.2 网络是成败第一位

最重要的不是把 Neutron 装起来，而是先把网络模型想清楚：

1. 管理网、存储网、overlay 网、外部网是否物理或逻辑隔离。
2. MTU 是否端到端一致。
3. 物理交换机 trunk、VLAN、ECMP、LACP 策略是否和云侧一致。
4. 外部网络、浮动 IP、SNAT 的地址池是否够用。
5. 是否需要 BGP、DVR、分布式网关、SR-IOV、DPDK。

一句实战经验：

> 私有云里 70% 的“OpenStack 问题”，最后根因其实是网络边界、MTU、交换机 trunk 或错误的物理拓扑假设。

### 8.3 控制面高可用不是“堆三台控制节点”就完了

控制面 HA 至少要考虑：

1. API VIP 和反向代理。
2. MariaDB / Galera 仲裁、时钟同步、磁盘延迟。
3. RabbitMQ 镜像队列、网络分区、磁盘水位。
4. Keystone Fernet key 分发机制。
5. OVN NB/SB DB 或其他网络控制数据库高可用。
6. 滚动升级时的兼容矩阵。

常见误区：

1. 控制节点数量够，但没有稳定 VIP 和健康检查。
2. 所有组件都堆在同一组磁盘上，I/O 抖动会把数据库和 MQ 一起拖慢。
3. 只做服务级 HA，不做配置、证书、密钥和数据库备份。

### 8.4 存储选型直接决定云的“性格”

`Ceph RBD`

1. 适合大规模、统一块存储、镜像和卷场景。
2. 和 OpenStack 结合紧密，但运维复杂度高。

`LVM + iSCSI`

1. 结构简单，适合小规模验证或传统 SAN。
2. 扩展性和多租户能力一般。

`NFS`

1. 简单，但性能和锁语义要看后端。
2. 对高并发数据库工作负载通常不是最佳选择。

一句面试结论：

> Cinder 负责“编排卷”，后端决定“卷到底好不好用”。所以评估 OpenStack 存储能力时，必须同时看 Cinder 架构和后端存储架构。

### 8.5 硬件和虚拟化基础别踩雷

1. CPU 虚拟化扩展必须统一开启。
2. BIOS、microcode、CPU 型号差异会影响 live migration。
3. NUMA、hugepage、SR-IOV 需要从宿主机、Flavor、Placement、Neutron 一起规划。
4. 磁盘控制器、RAID、缓存策略会直接影响控制面数据库和后端存储。
5. 时钟同步必须稳定，NTP 漂移会引发 token、数据库、集群仲裁一串连锁问题。

### 8.6 自动化部署和 Day-2 运维比 Day-0 更重要

生产环境至少要做到：

1. 基础配置代码化。
2. Fernet key、证书、密码、service account 有统一分发机制。
3. 升级、扩容、替换节点、数据库备份恢复有标准流程。
4. 日志、监控、告警和容量规划接入平台。
5. 定期做恢复演练，不要让备份只停留在“看起来存在”。

## 9. 高频面试追问，标准答法

### 9.1 为什么 OpenStack 容易被说“复杂”

答：

> 因为它不是一个单体平台，而是一组强解耦、强可插拔、强依赖的分布式系统。每个组件单独看都能理解，但一旦进入实例创建、网络转发、卷挂载、认证授权和 HA 协同，复杂度会呈乘法增长。

### 9.2 为什么说 OpenStack 更适合“有平台工程能力”的团队

答：

> 因为 OpenStack 提供的是基础能力和抽象，不是一个全托管产品。你需要自己做网络设计、版本治理、部署自动化、监控、备份、故障演练和团队协作机制。

### 9.3 Nova、Neutron、Cinder 三者的关系是什么

答：

> Nova 负责实例生命周期和调度，是主编排者；Neutron 负责端口、IP、路由和安全策略；Cinder 负责卷生命周期和存储后端编排。创建实例时，Nova 会分别调用 Neutron 和 Cinder，但网络流量和块数据并不通过 Nova 转发。

### 9.4 OpenStack 最关键的外部依赖是什么

答：

> 一般是数据库、消息队列、Keystone key 管理、底层网络和后端存储。OpenStack 很多故障看起来发生在 API，实际根因常在这几类依赖上。

### 9.5 私有云上线前必须做哪几项演练

答：

1. 控制节点单点故障切换。
2. RabbitMQ / MariaDB 故障恢复。
3. Keystone key 轮换和恢复。
4. 交换机 trunk / MTU / 外网链路回归验证。
5. Cinder 卷恢复和业务数据恢复。
6. 大规模并发创建实例压测。

## 10. 最后 1 分钟总结

你可以这样做收尾：

> OpenStack 的核心不是记住多少项目名，而是理解它如何把认证、调度、网络、块存储、镜像和多租户隔离组合成一个可运维的 IaaS 平台。架构上要抓住控制面和数据面分离，备份上要抓住控制面状态和租户数据是两条线，排障上要抓住状态、依赖和流量路径，私有云建设上则一定先做网络和故障域设计，再谈安装和功能。

如果面试官继续追问，你再补一句：

> 真正成熟的 OpenStack 方案，不是“服务都启动成功”，而是“故障来了以后，能定位、能切换、能恢复、能扩容”。
