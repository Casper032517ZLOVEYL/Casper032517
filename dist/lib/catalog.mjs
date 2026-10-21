/** Business definitions shared by the browser and Node tool runtime. */
export const METRICS = Object.freeze({
  revenue: { name: "GMV", unit: "元", a: "revenue" },
  orders: { name: "订单量", unit: "单", a: "orders" },
  registrations: { name: "注册量", unit: "人次", a: "registrations" },
  cost: { name: "投放成本", unit: "元", a: "cost" },
  ctr: { name: "点击率", unit: "%", a: "clicks", b: "impressions" },
  cvr: { name: "注册转化率", unit: "%", a: "registrations", b: "clicks" },
  roas: { name: "ROAS", unit: "倍", a: "revenue", b: "cost" },
  aov: { name: "客单价", unit: "元", a: "revenue", b: "orders" },
});

export const COLUMNS = Object.freeze([
  "date",
  "channel",
  "impressions",
  "clicks",
  "registrations",
  "orders",
  "revenue",
  "cost",
]);

export const KNOWLEDGE = Object.freeze([
  {
    id: "K01",
    title: "注册转化率口径",
    keys: ["转化", "cvr", "注册"],
    text: "注册转化率 = 注册量总和 / 点击量总和。先合并分子分母，再相除，不能直接平均各渠道转化率。变化同时展示相对百分比和百分点。",
  },
  {
    id: "K02",
    title: "GMV 与收入",
    keys: ["gmv", "收入", "销售", "金额", "营收"],
    text: "本项目将 revenue 定义为已支付订单金额（GMV，人民币），不是扣退款后的净收入。若实际字段口径不同，先确认口径再导入。",
  },
  {
    id: "K03",
    title: "变化贡献与原因",
    keys: ["为什么", "下降", "原因", "贡献", "异常"],
    text: "渠道贡献是描述性分解，不证明渠道策略导致变化。落地页、客群、价格和活动只是待验证假设；需要事件埋点、实验或额外数据。",
  },
  {
    id: "K04",
    title: "投放回报",
    keys: ["roas", "成本", "投放", "回报"],
    text: "ROAS = GMV / 投放成本，不等于利润率或 ROI。成本为零时结果不可计算。建议结合毛利与退款数据再决定预算。",
  },
  {
    id: "K05",
    title: "时间与完整性",
    keys: ["最近", "周", "天", "环比", "趋势"],
    text: "最近 N 天以整份数据的最大日期为锚点，包含当天，比较前 N 天。选中渠道在窗口内每天须有记录；没有记录的日期不能默认为零。",
  },
  {
    id: "K06",
    title: "异常规则",
    keys: ["异常", "预警"],
    text: "演示异常规则：相邻等长窗口指标相对变化绝对值达到 10%。这是规则预警，不是统计显著性检验。",
  },
]);

export function retrieve(question) {
  const q = question.toLowerCase();
  return KNOWLEDGE.map((item) => ({
    ...item,
    score: item.keys.filter((word) => q.includes(word)).length,
  }))
    .filter((item) => item.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
