/* Recipe costing — shared by the browser (window.Costing) and the server (require). */
(function (root) {
  // [family, size in the family's base unit]
  const UNITS = { kg: ['mass', 1000], g: ['mass', 1], l: ['vol', 1000], ml: ['vol', 1], pcs: ['count', 1], dozen: ['count', 12] };

  const convert = (qty, from, to) => {
    const a = UNITS[from], b = UNITS[to];
    if (!a || !b || a[0] !== b[0]) return qty;
    return (qty * a[1]) / b[1];
  };
  // Units a recipe line may use for an ingredient stocked in `unit`
  const unitsLike = (unit) => {
    const f = UNITS[unit] && UNITS[unit][0];
    return f ? Object.keys(UNITS).filter((k) => UNITS[k][0] === f) : [unit];
  };

  function rates(s = {}) {
    const hours = Number(s.gasCylinderHours) || 0;
    return { labour: Number(s.labourRate) || 0, gas: hours > 0 ? (Number(s.gasCylinderPrice) || 0) / hours : 0 };
  }

  const hasRecipe = (v) => !!(v && v.recipe);
  const round = (n) => Math.round(n * 100) / 100;

  // Cost of ONE piece of a variant: the batch's ingredients, your time and gas divided by the
  // number of pieces it makes, plus packaging for that piece.
  function recipeCost(recipe, ingredients = [], settings = {}) {
    const r = recipe || {};
    const yieldN = Math.max(1, Number(r.yield) || 1);
    const rate = rates(settings);
    const lines = (r.items || []).map((it) => {
      const ing = ingredients.find((i) => i.id === it.ingredientId);
      const qty = Number(it.qty) || 0;
      const cost = ing ? convert(qty, it.unit || ing.unit, ing.unit) * (Number(ing.cost) || 0) : 0;
      return { ...it, name: ing ? ing.name : '(deleted ingredient)', missing: !ing, cost };
    });
    const batch = {
      ingredients: lines.reduce((s, l) => s + l.cost, 0),
      labour: ((Number(r.labourMins) || 0) / 60) * rate.labour,
      gas: ((Number(r.gasMins) || 0) / 60) * rate.gas,
    };
    const each = {
      ingredients: batch.ingredients / yieldN,
      labour: batch.labour / yieldN,
      gas: batch.gas / yieldN,
      packaging: Number(r.packaging) || 0,
    };
    each.total = each.ingredients + each.labour + each.gas + each.packaging;
    return { yield: yieldN, lines, batch, each, rate };
  }

  const api = { UNITS, convert, unitsLike, rates, hasRecipe, recipeCost, round };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Costing = api;
})(this);
