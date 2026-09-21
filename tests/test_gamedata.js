/* 数据表自洽检查：不联网、不开浏览器就能抓住"表里写了、代码里没实现"这类假功能。 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const GD = require(path.join(__dirname, '..', 'jev', 'gamedata.js'));
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('五行是一圈而不是散点：每行恰好克一行，且不自克', () => {
  const keys = Object.keys(GD.WUXING);
  assert.equal(keys.length, 5);
  assert.equal(new Set(keys).size, 5);
  assert.equal(new Set(Object.values(GD.WUXING)).size, 5);
  for (const k of keys) {
    assert.notEqual(GD.WUXING[k], k);
    assert.ok(keys.includes(GD.WUXING[k]), `克了个不存在的五行：${k}`);
  }
});

test('克制系数对称：我克它 +30%，它克我 -25%，同系无关 1', () => {
  for (const [a, b] of Object.entries(GD.WUXING)) {
    assert.equal(GD.elementFactor(a, b), 1.3, `${a}克${b} 应当加成`);
    assert.equal(GD.elementFactor(b, a), 0.75, `${b}被${a}克 应当减益`);
  }
  assert.equal(GD.elementFactor('金', '金'), 1);
  assert.equal(GD.elementFactor(null, '金'), 1, '缺属性必须退化为 1，不能把伤害算成 0');
  assert.equal(GD.elementFactor('金', undefined), 1);
});

test('法宝表自洽：字段齐、id 唯一、每档都有货、主动必带充能', () => {
  const seen = new Set();
  for (const r of GD.RELICS) {
    for (const f of ['id', 'name', 'kind', 'tier', 'desc', 'fx']) assert.ok(r[f], `${r.id} 缺字段 ${f}`);
    assert.ok(['active', 'passive'].includes(r.kind), `${r.id} kind 非法`);
    assert.ok([1, 2, 3].includes(r.tier), `${r.id} tier 非法`);
    assert.ok(!seen.has(r.id), `id 重复：${r.id}`);
    seen.add(r.id);
    if (r.kind === 'active') assert.ok(r.charges >= 1, `${r.id} 是主动却没有充能`);
    if (r.el) assert.ok(GD.WUXING[r.el], `${r.id} 挂了个不存在的五行 ${r.el}`);
  }
  for (const t of [1, 2, 3]) assert.ok(GD.RELICS.some((r) => r.tier === t), `档位 ${t} 一件都没有`);
});

test('每件法宝的效果在 index.html 里真的有实现，不是只写在表里', () => {
  for (const r of GD.RELICS) {
    assert.ok(html.includes(`'${r.fx}'`), `${r.name} 的 fx=${r.fx} 在游戏代码里找不到`);
  }
});

test('煞气每项都必须同时有好处和代价，否则不算构筑选择', () => {
  assert.equal(GD.SHA.length, 8, 'Jev 给的档位是 2 条机制 / 8-10 件道具，煞气池不该无限膨胀');
  for (const s of GD.SHA) {
    assert.ok(GD.WUXING[s.el], `${s.id} 的命格 ${s.el} 不在五行里`);
    const good = s.atk > 0 || s.maxhp > 0 || s.hp_regen > 0 || s.gold_mult > 0 || s.burn > 0 || s.no_skill || s.reflect > 0 || s.shop_half || s.pierce > 0;
    const cost = s.atk < 0 || s.def < 0 || s.maxhp < 0 || s.hurt_mult > 0 || s.hp_leak > 0 || s.exp_mult < 0;
    assert.ok(good, `${s.id} 没有好处`);
    assert.ok(cost, `${s.id} 是纯增益 —— 白给的选项不会形成决策`);
  }
});

test('三个职业都有命格五行，否则开局就有一类人吃不到克制', () => {
  const classes = [...html.matchAll(/selectClass\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(classes.length >= 3, '没从页面里解析出职业，测试本身要修');
  for (const c of new Set(classes)) assert.ok(GD.CLASS_ELEMENT[c], `${c} 没有命格五行`);
});
