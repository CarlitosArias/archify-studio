const DIAGRAM_TYPES = ['workflow', 'architecture', 'sequence', 'dataflow', 'lifecycle'];

// "a -> b: etiqueta {variant}"  ->  { from, to, label, variant? }
// variant/role opcional entre llaves: {emphasis} {dashed} {security} {async} {return} {error}
const EDGE_ROLES = new Set(['main', 'branch', 'async', 'return', 'error']);
function parseLink(raw) {
  if (typeof raw === 'object') return raw;
  const arrow = raw.indexOf('->');
  if (arrow === -1) throw new Error(`enlace sin '->': "${raw}"`);
  const left = raw.slice(0, arrow).trim();
  let rest = raw.slice(arrow + 2).trim();
  let variant;
  const brace = rest.match(/\{([a-z]+)\}\s*$/i);
  if (brace) { variant = brace[1].toLowerCase(); rest = rest.slice(0, brace.index).trim(); }
  let label = '';
  const colon = rest.indexOf(':');
  if (colon !== -1) { label = rest.slice(colon + 1).trim(); rest = rest.slice(0, colon).trim(); }
  if (!left || !rest) throw new Error(`enlace inválido: "${raw}"`);
  return { from: left, to: rest, label, ...(variant ? { variant } : {}) };
}

function normalize(simple) {
  const type = simple.type;
  if (!DIAGRAM_TYPES.includes(type)) throw new Error(`type debe ser uno de ${DIAGRAM_TYPES.join(', ')}`);
  const nodes = (simple.nodes ?? []).map((n) => ({
    id: n.id, label: n.label ?? n.id, type: n.type ?? 'backend', sub: n.sub,
    ...(n.tag !== undefined ? { tag: n.tag } : {}),
    ...(n.stage !== undefined ? { stage: n.stage } : {}),
    ...(n.stageLabel !== undefined ? { stageLabel: n.stageLabel } : {})
  }));
  if (!nodes.length) throw new Error('se requiere al menos un nodo');
  const links = (simple.links ?? []).map(parseLink);
  return {
    type, title: simple.title ?? 'Diagrama', nodes, links,
    groups: simple.groups ?? [], stages: simple.stages ?? [],
    phases: simple.phases ?? [], segments: simple.segments ?? [],
    cards: simple.cards ?? []
  };
}

// role/variant del link -> campos que espera cada renderer.
const linkRole = (l) => (l.variant && EDGE_ROLES.has(l.variant) ? l.variant : undefined);
const linkVariant = (l) => (l.variant && !EDGE_ROLES.has(l.variant) ? l.variant : undefined);
const withCards = (spec, s) => (s.cards.length ? { ...spec, cards: s.cards } : spec);

function toArchitecture(s) {
  const GAP_X = 240, GAP_Y = 130, W = 140, H = 64, X0 = 40, Y0 = 60;
  // Columna = profundidad en la cadena de links (como capas); reduce cruces de aristas.
  const depth = new Map();
  const roots = s.nodes.map((n) => n.id).filter((id) => !s.links.some((l) => l.to === id));
  (roots.length ? roots : [s.nodes[0].id]).forEach((r) => depth.set(r, 0));
  let changed = true, guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    s.links.forEach((l) => { const d = (depth.get(l.from) ?? 0) + 1; if (d > (depth.get(l.to) ?? -1)) { depth.set(l.to, d); changed = true; } });
  }
  const rowByCol = new Map();
  const components = s.nodes.map((n) => {
    const col = depth.get(n.id) ?? 0;
    const row = rowByCol.get(col) ?? 0; rowByCol.set(col, row + 1);
    return {
      id: n.id, type: n.type, label: n.label, ...(n.sub ? { sublabel: n.sub } : {}),
      ...(n.tag ? { tag: n.tag } : {}),
      pos: [X0 + col * GAP_X, Y0 + row * GAP_Y], size: [W, H]
    };
  });
  return withCards({
    schema_version: 1, diagram_type: 'architecture', meta: { title: s.title },
    components,
    ...(s.groups.length ? { boundaries: s.groups.map((g) => ({ kind: g.kind ?? 'region', label: g.label, wraps: g.wraps ?? [] })) } : {}),
    connections: s.links.map((l, i) => ({ id: `c${i}`, from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}), ...(linkVariant(l) ? { variant: linkVariant(l) } : {}) }))
  }, s);
}

// Sigue la cadena de links para asignar columnas; nodos sin predecesor abren nueva lane.
function toWorkflow(s) {
  const order = [];
  const seen = new Set();
  const push = (id) => { if (!seen.has(id)) { seen.add(id); order.push(id); } };
  s.links.forEach((l) => { push(l.from); push(l.to); });
  s.nodes.forEach((n) => push(n.id));

  const colOf = new Map();
  const succ = new Map();
  s.links.forEach((l) => { (succ.get(l.from) ?? succ.set(l.from, []).get(l.from)).push(l.to); });
  const roots = order.filter((id) => !s.links.some((l) => l.to === id));
  const starts = roots.length ? roots : [order[0]];
  starts.forEach((r) => { if (!colOf.has(r)) colOf.set(r, 0); });
  let changed = true, guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    s.links.forEach((l) => {
      const c = (colOf.get(l.from) ?? 0) + 1;
      if (c > (colOf.get(l.to) ?? -1)) { colOf.set(l.to, Math.min(5, c)); changed = true; }
    });
  }
  order.forEach((id) => { if (!colOf.has(id)) colOf.set(id, 0); });

  const byCol = new Map();
  const laneOf = new Map();
  const nodeById = new Map(s.nodes.map((n) => [n.id, n]));
  order.forEach((id) => {
    const col = Math.min(5, colOf.get(id) ?? 0);
    const lane = byCol.get(col) ?? 0;
    byCol.set(col, lane + 1);
    laneOf.set(id, lane);
  });
  const laneCount = Math.max(1, ...[...laneOf.values()].map((l) => l + 1));
  const lanes = Array.from({ length: laneCount }, (_, i) => ({ id: `l${i}`, label: i === 0 ? 'Principal' : `Ramal ${i}` }));

  const nodes = order.map((id) => {
    const n = nodeById.get(id) ?? { id, label: id, type: 'backend' };
    return { id, lane: `l${laneOf.get(id)}`, col: Math.min(5, colOf.get(id) ?? 0), type: n.type ?? 'backend', label: n.label ?? id, ...(n.sub ? { sublabel: n.sub } : {}), ...(n.tag ? { tag: n.tag } : {}), width: 132 };
  });
  const mainPath = order.filter((id) => laneOf.get(id) === 0);
  return withCards({
    schema_version: 2, diagram_type: 'workflow', meta: { title: s.title },
    lanes, mainPath, nodes,
    edges: s.links.map((l, i) => ({ id: `e${i}`, from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}), role: linkRole(l) ?? 'branch', ...(linkVariant(l) ? { variant: linkVariant(l) } : {}) })),
    ...(s.phases.length ? { phases: s.phases.map((p) => ({ ...p, fromCol: Math.max(0, Math.min(5, p.fromCol ?? 0)), toCol: Math.max(0, Math.min(5, p.toCol ?? 5)) })) } : {}),
    ...(s.groups.length ? { groups: s.groups } : {})
  }, s);
}

function toSequence(s) {
  const participants = s.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, ...(n.sub ? { sublabel: n.sub } : {}) }));
  let y = 180;
  const messages = s.links.map((l, i) => { const m = { id: `m${i}`, from: l.from, to: l.to, y, ...(l.label ? { label: l.label } : {}), variant: linkVariant(l) ?? 'default' }; y += 60; return m; });
  const bottom = Math.max(480, y + 60);
  // segments simples = solo etiquetas; se reparten en bandas dentro del rango seguro
  // del canvas (el renderer exige que queden holgadamente dentro del viewBox).
  const segTop = 150, segBottom = bottom - 90;
  const segs = s.segments.map((seg, i) => {
    if (typeof seg === 'object') return seg;
    const span = (segBottom - segTop) / s.segments.length;
    return { from: Math.round(segTop + i * span), to: Math.round(segTop + (i + 1) * span), label: seg };
  });
  return withCards({
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: s.title, viewBox: [Math.max(480, 160 + participants.length * 150), bottom] },
    participants,
    ...(segs.length ? { segments: segs } : {}),
    messages
  }, s);
}

function toDataflow(s) {
  const stageLabels = s.stages.length ? s.stages : inferStages(s);
  const labelToIndex = new Map(stageLabels.map((l, i) => [l, i]));
  const maxStage = stageLabels.length - 1;

  // Solo se infiere por profundidad para los nodos SIN stage explícito.
  const depth = new Map();
  const roots = s.nodes.map((n) => n.id).filter((id) => !s.links.some((l) => l.to === id));
  (roots.length ? roots : [s.nodes[0].id]).forEach((r) => depth.set(r, 0));
  let changed = true, guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    s.links.forEach((l) => { const d = (depth.get(l.from) ?? 0) + 1; if (d > (depth.get(l.to) ?? -1)) { depth.set(l.to, d); changed = true; } });
  }

  const explicitStage = (n) => {
    if (typeof n.stage === 'number') return Math.max(0, Math.min(maxStage, n.stage));
    if (n.stageLabel !== undefined && labelToIndex.has(n.stageLabel)) return labelToIndex.get(n.stageLabel);
    return null;
  };

  const rowByStage = new Map();
  const nodes = s.nodes.map((n) => {
    const stage = explicitStage(n) ?? Math.min(maxStage, depth.get(n.id) ?? 0);
    const row = rowByStage.get(stage) ?? 0; rowByStage.set(stage, row + 1);
    return { id: n.id, type: n.type, label: n.label, ...(n.sub ? { sublabel: n.sub } : {}), ...(n.tag ? { tag: n.tag } : {}), stage, row };
  });
  return withCards({
    schema_version: 1, diagram_type: 'dataflow', meta: { title: s.title },
    stages: stageLabels.map((label) => ({ label })),
    nodes,
    flows: s.links.map((l, i) => ({ id: `f${i}`, from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}), ...(l.classification ? { classification: l.classification } : {}), ...(linkVariant(l) ? { variant: linkVariant(l) } : {}), labelDy: 24 }))
  }, s);
}

function inferStages(s) {
  const depth = new Map();
  const roots = s.nodes.map((n) => n.id).filter((id) => !s.links.some((l) => l.to === id));
  (roots.length ? roots : [s.nodes[0].id]).forEach((r) => depth.set(r, 0));
  let changed = true, guard = 0;
  while (changed && guard++ < 100) { changed = false; s.links.forEach((l) => { const d = (depth.get(l.from) ?? 0) + 1; if (d > (depth.get(l.to) ?? -1)) { depth.set(l.to, d); changed = true; } }); }
  const max = Math.max(0, ...[...depth.values()]);
  return Array.from({ length: max + 1 }, (_, i) => `Etapa ${i + 1}`);
}

function toLifecycle(s) {
  const colOf = new Map();
  const order = [];
  const seen = new Set();
  s.links.forEach((l) => { [l.from, l.to].forEach((id) => { if (!seen.has(id)) { seen.add(id); order.push(id); } }); });
  s.nodes.forEach((n) => { if (!seen.has(n.id)) { seen.add(n.id); order.push(n.id); } });
  order.forEach((id, i) => colOf.set(id, i));
  const nodeById = new Map(s.nodes.map((n) => [n.id, n]));
  const states = order.map((id, i) => {
    const n = nodeById.get(id) ?? { id, label: id, type: 'active' };
    return { id, type: n.type ?? 'active', label: n.label ?? id, ...(n.sub ? { sublabel: n.sub } : {}), ...(n.tag ? { tag: n.tag } : {}), lane: 'main', col: Math.min(4, i), step: String(i + 1).padStart(2, '0') };
  });
  return withCards({
    schema_version: 1, diagram_type: 'lifecycle', meta: { title: s.title },
    lanes: [{ id: 'main', label: 'Ciclo de vida' }],
    states,
    transitions: s.links.map((l, i) => ({ id: `t${i}`, from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}), ...(linkVariant(l) ? { variant: linkVariant(l) } : {}) }))
  }, s);
}

const BUILDERS = { architecture: toArchitecture, workflow: toWorkflow, sequence: toSequence, dataflow: toDataflow, lifecycle: toLifecycle };

export function expand(simple) {
  const s = normalize(simple);
  return BUILDERS[s.type](s);
}
