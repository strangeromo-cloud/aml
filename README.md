# Lenovo AML Risk Watch

一个可解释、可引证的公司合规风险评分 Demo 网站。基于 6 类 AML Skills 对 200 家 Lenovo 的客户和供应商（合成数据）进行综合风险评分，每一个因子都能追溯到真实的权威数据源。

> **⚠︎ Illustrative demo only.** Company data is synthetic; country-level reference data is a snapshot of real public sources. Not a substitute for professional sanctions screening.

---

## 核心特性

- **6 维度综合评分引擎** — Sanctions Screening · Country Risk · High-Risk Jurisdiction Monitoring · Circumvention · PEP & Adverse Media · Country Context Enrichment
- **每个因子都有数据源引证** — 点击 badge 跳转到 FATF / OFAC / UN / EU / Basel / Transparency International / World Bank 等权威公开数据
- **中英双语切换** — 顶部导航可切换，状态存 localStorage
- **模糊搜索** — Fuse.js 驱动的客户端搜索，支持公司名、行业、HQ 国家
- **风险分布可视化** — Recharts 饼图 + 国家热点柱状图
- **200 家公司** — 100 客户 + 100 供应商，风险分布 ~150/40/8/3（Low/Medium/High/Critical）
  - 30 家为真实知名公司名（仅限明确合规的大厂，全部落在 Low 风险）
  - 170 家合成名 —  High/Critical 风险公司全部为合成，避免暗示真实公司合规问题

---

## 技术栈

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Recharts · Fuse.js · lucide-react
- 无后端、无数据库 — 全部静态 JSON

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 生成 200 家 mock 公司（首次必需；使用种子 PRNG，结果可复现）
npm run data:gen

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000
```

---

## 部署到 Zeabur

Zeabur 会自动识别 Next.js 项目（基于 `package.json`），无需额外配置文件。

### 方案 A：通过 Git 仓库部署（推荐）

```bash
# 1. 初始化 Git 仓库
cd /Users/cloud/Documents/aml
git init
git add .
git commit -m "Initial commit: AML risk watch platform"

# 2. 推到 GitHub / GitLab
git remote add origin https://github.com/<你的用户名>/aml-risk-watch.git
git branch -M main
git push -u origin main
```

然后在 Zeabur 控制台：

1. 打开 https://zeabur.com/ → 登录
2. **Create Project** → 选地区（推荐 `hkg1` 或 `aws-sin1`）
3. **Add Service** → **Git** → 选择刚推的仓库
4. Zeabur 会自动识别为 Next.js 项目并开始构建
5. 构建完成后 **Domains** 标签页 → **Generate Domain** 获得 `xxx.zeabur.app` 访问地址

### 方案 B：Zeabur CLI 直传

```bash
npm install -g zeabur
zeabur login
cd /Users/cloud/Documents/aml
zeabur deploy
```

### Zeabur 会自动执行的步骤

1. `npm install`（含 devDependencies，保证 `tsx` 可用）
2. `npm run build` → 触发 `prebuild` 自动运行 `tsx scripts/generate-companies.ts` 生成 200 家公司，再 `next build`
3. `npm run start` → `next start -p $PORT`

### 预期构建产物

Next.js 会把 **所有 207 页预渲染为静态 HTML**（5 个主页面 + 200 个公司详情页 + 2 个 not-found）。首次访问秒开，不依赖 Node 运行时做渲染。

### 注意事项

- **Node 版本**：`package.json` 的 `engines` 字段声明 `>=18.17.0`，Zeabur 会自动匹配
- **PORT**：`next start -p ${PORT:-3000}` 已处理 Zeabur 注入的 `PORT` 环境变量
- **数据生成**：`prebuild` 脚本保证每次部署都会基于 seed PRNG 重新生成一致的公司数据；也可以直接把 `data/companies.json` 提交到仓库然后把 `prebuild` 删掉
- **静态导出（可选）**：如果想纯静态托管到 CDN，可以在 `next.config.mjs` 加 `output: "export"`，然后 Zeabur 会自动把 `out/` 目录当静态资源托管

---

## 目录结构

```
aml/
├── app/                         # Next.js App Router 页面
│   ├── page.tsx                 # 首页 (搜索 + Top10 + stats + charts)
│   ├── company/[id]/page.tsx    # 公司详情页 (六维度分解)
│   ├── companies/page.tsx       # 全部公司列表 (可筛选/排序)
│   ├── methodology/page.tsx     # 评分方法论
│   └── sources/page.tsx         # 数据源目录
├── components/                  # UI 组件
│   ├── home-content.tsx         # 首页主内容
│   ├── company-detail.tsx       # 公司详情
│   ├── companies-list.tsx       # 公司列表 + 筛选
│   ├── methodology-content.tsx  # 方法论页
│   ├── sources-content.tsx      # 数据源页
│   ├── search-bar.tsx           # Fuse.js 自动补全搜索
│   ├── top-risk-list.tsx        # Top 10 表格
│   ├── risk-gauge.tsx           # 环形总分仪表
│   ├── dimension-card.tsx       # 可展开的维度卡（含因子 + 来源引证）
│   ├── country-flag.tsx         # ISO-2 → 国旗 emoji
│   ├── language-switcher.tsx
│   ├── header.tsx / footer.tsx
│   └── ui.tsx                   # Card / Badge / RiskBadge / Button / Progress
├── lib/
│   ├── types.ts                 # TypeScript 类型 + 权重/等级常量
│   ├── data.ts                  # 数据加载 + 查询工具
│   ├── scoring/                 # 6 个维度的评分模块
│   │   ├── index.ts             # 总编排
│   │   ├── sanctions.ts
│   │   ├── country-risk.ts
│   │   ├── jurisdiction.ts
│   │   ├── circumvention.ts
│   │   ├── pep-media.ts
│   │   └── enrichment.ts
│   ├── i18n/
│   │   ├── en.json / zh.json
│   │   └── context.tsx
│   └── utils.ts
├── data/
│   ├── sources.json             # 12 个真实权威数据源（URL + 快照日期）
│   ├── countries.json           # 55 个国家真实数据（FATF / OFAC / Basel / CPI / WGI 快照）
│   └── companies.json           # 200 家合成公司 (由 scripts/generate-companies.ts 生成)
└── scripts/
    ├── generate-companies.ts
    └── sanity-check.ts          # 打印 Top/Bottom 风险 + 分布
```

---

## 评分方法

### 维度权重

| 维度 | 权重 |
|---|---|
| Sanctions Screening | 25% |
| Country Risk Scoring | 20% |
| High-Risk Jurisdiction Monitoring | 15% |
| Sanctions Circumvention Risk | 15% |
| PEP & Adverse Media | 15% |
| Country Context Enrichment | 10% |

### 公式

```
overall = Σ (dimension_score × dimension_weight) / Σ weights
```

每个维度包含 3 个因子，因子也有内部权重。

### 风险等级阈值

| 等级 | 分数区间 |
|---|---|
| Low | 0 – 24 |
| Medium | 25 – 49 |
| High | 50 – 69 |
| Critical | 70 – 100 |

完整的因子清单和数据源映射见应用内 `/methodology` 页面。

---

## 数据源（12 个）

| ID | 权威 | 快照 |
|---|---|---|
| fatf_lists | FATF | 2026-02 |
| ofac_sdn | U.S. Treasury OFAC | 2026-03 |
| ofac_countries | U.S. Treasury OFAC | 2026-03 |
| un_consolidated | UN Security Council | 2026-03 |
| eu_consolidated | European Commission | 2026-03 |
| basel_aml | Basel Institute on Governance | 2024 |
| ti_cpi | Transparency International | 2024 |
| wb_wgi | World Bank | 2024 |
| wjp_rol | World Justice Project | 2024 |
| tjn_fsi | Tax Justice Network | 2022 |
| open_sanctions | OpenSanctions | 2026-03 |
| control_risks_geo | Control Risks | 2025 |

详情见 `data/sources.json` 和应用内 `/sources` 页面。

---

## 免责声明

本应用是 AML / 合规评分架构的**技术演示**。

- 公司风险分数基于合成数据生成
- 出现的真实公司名（Intel、AMD、TSMC、Bank of America 等）仅作为良性占位符用于示意低风险 Tier-1 实体画像，**不反映任何真实合规评估**
- 国家级参考数据是权威公开来源的**快照**，可能已过时于最新名单
- **不能替代专业的制裁筛查与尽职调查**

---

## License

Internal demo, all rights reserved.
