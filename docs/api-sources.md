# API 接入指南

12 个**通过 API 接入**的数据源完整说明（剩下 8 个是 List/PDF/HTML 源，已由
[`scripts/data-refresh`](../scripts/data-refresh/README.md) 自动抓取）。

---

## 速览表

| # | 数据源 | 认证 | 免费/商业 | 申请方式 |
|---:|---|---|---|---|
| 1 | **Trade.gov Consolidated Screening List** | 免费 API key | 🟢 免费 | https://api.trade.gov/ |
| 2 | **OpenSanctions** | 免费 + 付费 tier | 🟢 免费 / 🟡 付费 | https://www.opensanctions.org/api/ |
| 3 | **World Bank Indicators** | 无需 key | 🟢 免费 | 无需申请 |
| 4 | **GDELT** | 无需 key | 🟢 免费 | 无需申请 |
| 5 | **EU Consolidated Financial Sanctions** | Token | 🟢 免费 | 公开 token `dG9rZW4tMjAxNw` |
| 6 | **UN Consolidated XML** | 无需 key | 🟢 免费 | 无需申请 |
| 7 | **Dow Jones Risk & Compliance** | OAuth + API key | 🔴 商业 | sales@dowjones.com |
| 8 | **Refinitiv World-Check One** | OAuth | 🔴 商业 | https://developers.lseg.com |
| 9 | **Moody's Orbis + GRID** | API key + IP allowlist | 🔴 商业 | https://www.moodys.com/sales |
| 10 | **LexisNexis Nexis API** | OAuth 2.0 | 🔴 商业 | https://www.lexisnexis.com/sales |
| 11 | **ComplyAdvantage** | API key (Bearer) | 🔴 商业（中端） | https://complyadvantage.com/contact/ |
| 12 | **Sayari Graph API** | API key | 🔴 商业 | https://sayari.com/contact/ |

---

# 🟢 免费 / 开放公共 API（4 个）

## 1. Trade.gov Consolidated Screening List

**最重要的免费筛查 API**——把 OFAC SDN + 8 个其他美国制裁名单聚合成一个可查询接口。

- **Base URL**: `https://api.trade.gov/static/consolidated_screening_list/`
- **搜索 API**: `https://api.trade.gov/consolidated_screening_list/v1/search`
- **认证**: 免费 API key（注册 `https://api.trade.gov/key-signup/`）
- **限流**: 1000 次/小时
- **数据量**: ~25,000 条聚合记录（OFAC SDN + Non-SDN PLC List + Sectoral + ITAR Debarred + DPL + EL + UVL + …）

### 关键端点

| 用途 | 端点 |
|---|---|
| 模糊搜索 | `GET /search?q=<name>&fuzzy_name=true&size=10` |
| 精确搜索 | `GET /search?name=<name>` |
| 按国家筛 | `GET /search?countries=IR,RU` |
| 全量下载 | `GET /static/consolidated_screening_list/consolidated.csv` |

### 示例请求

```bash
# 模糊搜索 "Bank Saderat"
curl -H "subscription-key: YOUR_KEY" \
  "https://api.trade.gov/consolidated_screening_list/v1/search?q=Bank+Saderat&fuzzy_name=true&size=5"
```

```python
import requests
r = requests.get(
    "https://api.trade.gov/consolidated_screening_list/v1/search",
    params={"q": "Bank Saderat", "fuzzy_name": "true", "size": 5},
    headers={"subscription-key": "YOUR_KEY"},
    timeout=30,
)
results = r.json()["results"]
for hit in results:
    print(hit["name"], hit["source"], hit["addresses"])
```

### 返回字段（每条记录）

```json
{
  "source": "Specially Designated Nationals (SDN) - Treasury Department",
  "entity_number": "12345",
  "type": "Entity",
  "name": "BANK SADERAT IRAN",
  "addresses": [{"country": "IR", "city": "Tehran"}],
  "alt_names": ["Saderat Bank"],
  "remarks": "...",
  "score": 0.95
}
```

### 文档
- API 文档: https://api.trade.gov/consolidated_screening_list_data
- 注册 key: https://api.trade.gov/key-signup/

---

## 2. OpenSanctions

聚合制裁、PEP、监控名单。开源免费 + 商业 SaaS 版。

- **Base URL**: `https://api.opensanctions.org/`
- **搜索文档**: `https://www.opensanctions.org/api/`
- **免费层**: 自托管或申请 API key（个人开发者免费） · 商业用 yente（自托管）或 SaaS
- **限流**: 免费 60 req/min；自托管无限
- **数据量**: ~600,000 条聚合实体（PEP ~250k + 制裁 + 监控 + 关注名单）

### 关键端点

| 用途 | 端点 |
|---|---|
| 搜索 | `GET /search/<dataset>?q=<name>` |
| 实体匹配（fuzzy） | `POST /match/<dataset>` |
| 单个实体 | `GET /entities/<id>` |
| 数据集列表 | `GET /datasets` |

### 示例请求

```bash
# 搜索默认数据集
curl -H "Authorization: ApiKey YOUR_KEY" \
  "https://api.opensanctions.org/search/default?q=Vladimir+Putin&limit=5"
```

```python
import requests
r = requests.post(
    "https://api.opensanctions.org/match/default",
    headers={"Authorization": "ApiKey YOUR_KEY", "Content-Type": "application/json"},
    json={"queries": {
        "q1": {
            "schema": "Person",
            "properties": {
                "name": ["Vladimir Putin"],
                "birthDate": ["1952-10-07"],
            },
        }
    }},
    timeout=30,
)
print(r.json()["responses"]["q1"]["results"][:3])
```

### 申请 API key

https://www.opensanctions.org/account/ — 免费个人 key（rate limit 60/min）；
商业用量去 https://www.opensanctions.org/contact/ 谈合同（含 Yente 自托管授权）。

---

## 3. World Bank Indicators

国家级治理 / 经济 / 风险指标。**完全免费、无需 key**。

- **Base URL**: `https://api.worldbank.org/v2/`
- **格式**: 默认 XML，加 `?format=json` 切 JSON
- **限流**: 无明确限制（IP 级 ~1000/分钟）
- **数据量**: 约 1500+ 指标 × 215 国家 × 多年数据

### 关键端点

| 用途 | 端点 |
|---|---|
| 全部国家 | `GET /country?format=json&per_page=300` |
| WGI 控腐败 | `GET /country/all/indicator/CC.EST?format=json&per_page=10000` |
| WGI 法治 | `GET /country/all/indicator/RL.EST?format=json&per_page=10000` |
| 单国家单指标 | `GET /country/CN/indicator/CC.EST?format=json` |
| 指标搜索 | `GET /indicator?format=json&search=corruption` |

### 6 个 WGI 指标代码

| 维度 | 代码 |
|---|---|
| Voice and Accountability | `VA.EST` |
| Political Stability | `PV.EST` |
| Government Effectiveness | `GE.EST` |
| Regulatory Quality | `RQ.EST` |
| **Rule of Law** | `RL.EST` |
| **Control of Corruption** | `CC.EST` ← 当前 dashboard 使用 |

### 示例请求

```bash
# 拉中国近 10 年 Control of Corruption
curl "https://api.worldbank.org/v2/country/CN/indicator/CC.EST?format=json&per_page=10"
```

```python
import requests
r = requests.get(
    "https://api.worldbank.org/v2/country/all/indicator/CC.EST",
    params={"format": "json", "per_page": 10000, "date": "2024"},
    timeout=60,
)
data = r.json()[1]  # [0] is metadata, [1] is data
for d in data[:5]:
    print(f"{d['country']['value']:30}  {d['value']}")
```

### 文档
https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

---

## 4. GDELT — Global Database of Events, Language, and Tone

全球新闻 / 事件实时监控。**完全免费、无需 key**。每 15 分钟更新。

- **Base URL**: `https://api.gdeltproject.org/api/v2/`
- **限流**: 软限制（短时间高频会被节流）
- **数据量**: 25 亿+ 全球事件（自 1979 起）

### 关键端点

| 用途 | 端点 |
|---|---|
| 文章搜索 | `GET /doc/doc?query=<q>&mode=ArtList&format=json` |
| 时间序列 | `GET /doc/doc?query=<q>&mode=TimelineVol&format=json` |
| 事件流 | `GET /events/eventgkg/eventgkg?...` |
| BigQuery（深度查询） | `gdelt-bq.full.events` 等 |

### 示例：抓取某公司的负面媒体

```python
import requests, urllib.parse
def adverse_media_count(company: str, months: int = 24) -> int:
    q = f'"{company}" (laundering OR fraud OR sanctions OR corruption OR bribery OR investigation)'
    r = requests.get(
        "https://api.gdeltproject.org/api/v2/doc/doc",
        params={
            "query": q,
            "mode": "ArtList",
            "format": "json",
            "timespan": f"{months}m",
            "maxrecords": 250,
        },
        timeout=30,
    )
    return len(r.json().get("articles", []))

print(adverse_media_count("Wirecard"))   # 数百
print(adverse_media_count("Apple Inc"))  # 接近 0
```

### 文档
https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

---

# 🟡 半公开 / Token-gated（2 个）

## 5. EU Consolidated Financial Sanctions

提供 XML 下载，URL 含一个**永久公开的 token**（`dG9rZW4tMjAxNw`）。我们 dashboard
当前已用此方式（见 `lib/fetch/eu-consolidated.py`）。

- **下载 URL**:
  ```
  https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw
  ```
- **格式**: XML（FSD 1.1 schema）
- **更新**: 每月

### 命令行

```bash
curl -L -o eu-sanctions.xml \
  "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
```

### 文档
https://webgate.ec.europa.eu/fsd/fsf

---

## 6. UN Consolidated Sanctions XML

XML 直接下载，无需 token。

- **下载 URL**:
  ```
  https://scsanctions.un.org/resources/xml/en/consolidated.xml
  ```
- **格式**: XML
- **更新**: 每月

### 文档
https://www.un.org/securitycouncil/content/un-sc-consolidated-list

---

# 🔴 商业 API（6 个，需谈合同）

## 7. Dow Jones Risk & Compliance / Factiva

联想现有合规数据供应商。

- **Base URL**: `https://api.dowjones.com/risk-compliance/v1/`
- **认证**: OAuth 2.0 client credentials → 拿 access token → Bearer 调用
- **限流**: 按合同（典型 100 req/sec）
- **数据量**: ~500 万条画像（PEP、制裁、监管处罚、关联媒体）

### 关键端点

| 用途 | 端点 |
|---|---|
| 实体筛查 | `POST /search/persons` 或 `POST /search/companies` |
| 实体详情 | `GET /entities/{id}` |
| 监控订阅（webhook） | `POST /monitoring/subscriptions` |
| 时间点查询（合规审计） | `GET /entities/{id}/snapshots/{date}` |

### 示例

```bash
# 1. 拿 access token
curl -X POST https://accounts.dowjones.com/oauth2/v1/token \
  -d "grant_type=client_credentials&scope=djid" \
  -u "$CLIENT_ID:$CLIENT_SECRET"

# 2. 用 token 查
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.dowjones.com/risk-compliance/v1/search/persons?q=Putin"
```

### 申请
- 销售: sales@dowjones.com
- 文档: https://developer.dowjones.com/site/global/develop/api_libraries/risk_and_compliance/index.gsp

---

## 8. Refinitiv (LSEG) World-Check One

最被引用的合规数据集。

- **Base URL**: `https://api-worldcheck.refinitiv.com/v2/`
- **认证**: HMAC-SHA256 签名（API key + secret）或 OAuth via LSEG Data Platform
- **数据量**: ~600 万条画像

### 关键端点

| 用途 | 端点 |
|---|---|
| 案例创建（screening run） | `POST /cases` |
| 案例结果 | `GET /cases/{id}/results` |
| 实体详情 | `GET /references/{ref}` |

### 示例（HMAC 签名复杂，建议用官方 SDK）

```python
# pip install refinitiv-data
import refinitiv.data as rd
rd.open_session(name="default")
session = rd.session.platform.Definition(app_key="...").get_session()
# 然后通过 session 调用 World-Check One endpoints
```

### 申请
https://developers.lseg.com/en/api-catalog/world-check/world-check-one-api

---

## 9. Moody's Orbis + GRID

公司层级 + 受益所有权 + 监管处罚的最深商业数据。

- **Orbis Base URL**: `https://api.bvdinfo.com/v1/orbis/`
- **GRID Base URL**: `https://api.moodys.com/grid/v1/`
- **认证**: API key + IP allowlist + Subject ID（合同里指定）
- **数据量**: Orbis 5 亿+ 公司；GRID ~1300 万实体

### 关键端点

| 用途 | 端点 |
|---|---|
| 公司搜索 | `POST /Companies/Match` |
| UBO 关系图 | `GET /Companies/{id}/Beneficial` |
| GRID 制裁查询 | `POST /grid/Search` |
| 行业 / 财务 / 评级 | `GET /Companies/{id}/...` |

### 申请
https://www.moodys.com/web/en/us/contact-us.html

---

## 10. LexisNexis WorldCompliance + Nexis Diligence

法律 / 诉讼 / 监管处罚最强。

- **Nexis API Base URL**: `https://services-api.lexisnexis.com/v1/`
- **认证**: OAuth 2.0
- **数据量**: ~300 万条合规画像 + 海量法律记录

### 关键端点

| 用途 | 端点 |
|---|---|
| 实体筛查 | `POST /WorldComplianceSearch` |
| 法律记录搜索 | `POST /News` |
| 公司诉讼 | `POST /CompanyDossier` |

### 申请
https://www.lexisnexis.com/en-us/contact-us/sales.page

---

## 11. ComplyAdvantage

中型机构友好 API（年费 ~$15-50k）。

- **Base URL**: `https://api.complyadvantage.com/`
- **认证**: API key（Bearer token）
- **限流**: 按 plan（典型 60 req/min for starter）
- **数据量**: ~500 万条聚合数据 + 实时负面媒体

### 关键端点

| 用途 | 端点 |
|---|---|
| 创建搜索 | `POST /searches` |
| 拉取结果 | `GET /searches/{id}` |
| 监控订阅 | `POST /searches/{id}/monitors` |

### 示例

```bash
curl -X POST "https://api.complyadvantage.com/searches" \
  -H "Authorization: Token $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_term": "Bank Saderat Iran",
    "fuzziness": 0.5,
    "filters": {"types": ["sanction", "warning"]}
  }'
```

### 申请
https://complyadvantage.com/contact/

---

## 12. Sayari Graph API

制裁规避 / 壳公司追溯一流。

- **Base URL**: `https://api.sayari.com/v1/`
- **认证**: API key
- **数据量**: 40 亿+ 实体记录（公司 + 关系网络）

### 关键端点

| 用途 | 端点 |
|---|---|
| 实体搜索 | `POST /search/entity` |
| 公司关联（图遍历） | `POST /traversal/{entity_id}` |
| 受益人链 | `GET /entity/{id}/ubo` |
| 风险信号订阅 | `POST /monitoring/subscriptions` |

### 申请
https://sayari.com/contact/

---

# 🛠️ 实务整合方案

## 优先级建议

```
Phase 1（免费 / 低成本，立即可做）
   ├─ Trade.gov CSL  ──────  替代 OFAC SDN 全量下载
   ├─ World Bank     ──────  替代 WGI Excel 下载
   ├─ OpenSanctions  ──────  增强模糊匹配 + 聚合 PEP
   └─ GDELT          ──────  补充 adverse media（免费版）

Phase 2（双轨评估期，4 周）
   ├─ Dow Jones      ──────  与现有合同方案并行评估
   └─ ComplyAdvantage ─────  备选商业方案对比

Phase 3（按需扩展）
   ├─ Sayari         ──────  规避追溯（如果 ECO 关注）
   ├─ Moody's Orbis  ──────  深度 UBO 研究
   └─ Refinitiv      ──────  与 DJ 二选一
```

## 在我们 dashboard 里加新 API 的代码模板

```typescript
// lib/fetch/<provider>.ts
import { sleep, withRetry } from "./common";

const BASE = "https://api.example.com/v1";
const API_KEY = process.env.PROVIDER_API_KEY;

export async function searchEntity(name: string) {
  return withRetry(async () => {
    const r = await fetch(`${BASE}/search?q=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}
```

每接一个新供应商：
1. 在 `lib/fetch/<provider>.ts` 实现 adapter（映射到 `Company` / `UBO` 类型）
2. 在 `lib/data.ts` 加 `DATA_PROVIDER` 环境变量分支
3. 跑 `data:diff` 比较新旧供应商的 risk score 差异

---

# 🔐 API key 管理

| 类型 | 推荐做法 |
|---|---|
| **本地开发** | `.env.local`（不提交） |
| **CI / GitHub Actions** | Repository Secrets（`Settings → Secrets and variables`） |
| **Zeabur 部署** | Environment Variables（项目级配置） |
| **企业** | Vault / AWS Secrets Manager / Azure Key Vault 集中管理 |

⚠️ **永远不要** commit API key 到 git。即使是私有仓库也不要——key 一旦泄漏要轮换的成本极高。

---

# 📞 联系方式速查（中文销售/支持）

| 厂商 | 中国销售 / 亚太支持 |
|---|---|
| Dow Jones | sales-asia@dowjones.com |
| Refinitiv (LSEG) | https://www.lseg.com/zh/contact-us |
| Moody's | china@moodys.com |
| LexisNexis | https://www.lexisnexis.com.cn/contact-us |
| ComplyAdvantage | apac@complyadvantage.com |
| Sayari | sales@sayari.com |
| Dun & Bradstreet (华夏邓白氏) | https://www.huaxiadnb.com/ |
