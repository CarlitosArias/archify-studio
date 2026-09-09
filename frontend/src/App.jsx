import { useState, useEffect, useCallback, useRef } from 'react';

const API = '/api';
const DIAGRAM_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];

const COMMON_NODE_TYPES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
const NODE_TYPES_BY_DIAGRAM = {
  architecture: COMMON_NODE_TYPES,
  workflow: COMMON_NODE_TYPES,
  sequence: COMMON_NODE_TYPES,
  dataflow: COMMON_NODE_TYPES,
  lifecycle: ['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external']
};

const TEMPLATES = {
  architecture: {
    title: 'Plataforma Web (ejemplo completo)',
    nodes: [
      { id: 'users', label: 'Usuarios', type: 'external', sub: 'Navegador / Móvil' },
      { id: 'api', label: 'API', type: 'backend', sub: 'FastAPI :8000', tag: 'JWT' },
      { id: 'cache', label: 'Redis', type: 'database', sub: 'cache :6379' },
      { id: 'db', label: 'PostgreSQL', type: 'database', sub: 'primary :5432' },
      { id: 'queue', label: 'SQS', type: 'messagebus', sub: 'cola de trabajos' },
      { id: 'worker', label: 'Worker', type: 'backend', sub: 'jobs async' }
    ],
    links: [
      'users -> api: HTTPS {emphasis}',
      'api -> cache: read-through',
      'api -> db: SQL',
      'api -> queue: encolar {dashed}',
      'queue -> worker'
    ],
    groups: [
      { kind: 'region', label: 'AWS us-west-2', wraps: ['api', 'cache', 'db', 'queue', 'worker'] },
      { kind: 'security-group', label: 'sg-api :443', wraps: ['api'] }
    ],
    cards: [
      { dot: 'cyan', title: 'Borde', items: ['La API valida JWT', 'Redis cache read-through'] },
      { dot: 'rose', title: 'Async', items: ['Trabajo diferido por SQS + Worker'] }
    ]
  },
  workflow: {
    title: 'Flujo del agente (ejemplo completo)',
    nodes: [
      { id: 'user', label: 'Usuario', type: 'external', sub: 'pide trabajo' },
      { id: 'chat', label: 'Chat', type: 'frontend', sub: 'hilo + archivos' },
      { id: 'planner', label: 'Planner', type: 'backend', sub: 'planifica', tag: 'context aware' },
      { id: 'router', label: 'Router', type: 'backend', sub: 'elige tool' },
      { id: 'approval', label: 'Aprobación', type: 'security', sub: 'consentimiento', tag: 'bloquea riesgo' },
      { id: 'tool', label: 'Tool Call', type: 'messagebus', sub: 'shell / MCP' },
      { id: 'final', label: 'Respuesta', type: 'backend', sub: 'resultado' }
    ],
    links: [
      'user -> chat',
      'chat -> planner: plan {emphasis}',
      'planner -> router',
      'router -> approval: ¿aprobar? {security}',
      'approval -> tool: aprobado {emphasis}',
      'tool -> final: resultado {return}',
      'router -> final: directo {dashed}'
    ],
    phases: [
      { id: 'intake', label: 'Ingreso', fromCol: 0, toCol: 1 },
      { id: 'plan', label: 'Planeación', fromCol: 2, toCol: 3, variant: 'emphasis' },
      { id: 'exec', label: 'Ejecución', fromCol: 4, toCol: 6, variant: 'dashed' }
    ],
    cards: [
      { dot: 'cyan', title: 'Contrato', items: ['Carriles y columnas ubican los nodos', 'Las rutas se mantienen ortogonales'] },
      { dot: 'rose', title: 'Semántica', items: ['La aprobación bloquea trabajo riesgoso'] }
    ]
  },
  sequence: {
    title: 'Cache miss (ejemplo completo)',
    nodes: [
      { id: 'user', label: 'Usuario', type: 'external', sub: 'sesión' },
      { id: 'web', label: 'Web App', type: 'frontend' },
      { id: 'api', label: 'API', type: 'backend', sub: 'FastAPI' },
      { id: 'cache', label: 'Redis', type: 'database' },
      { id: 'db', label: 'PostgreSQL', type: 'database' }
    ],
    links: [
      'user -> web: abre página',
      'web -> api: GET /data {emphasis}',
      'api -> cache: ¿hit?',
      'cache -> api: miss {dashed}',
      'api -> db: SELECT',
      'db -> api: filas {return}',
      'api -> web: 200 OK {return}'
    ],
    segments: ['Petición', 'Resolución', 'Respuesta'],
    cards: [
      { dot: 'emerald', title: 'Camino feliz', items: ['Web -> API -> datos -> respuesta', 'Los retornos son más tenues que las llamadas'] }
    ]
  },
  dataflow: {
    title: 'Order Event Stream (ejemplo completo)',
    stages: ['Producers', 'Transport', 'Processors', 'Consumers'],
    nodes: [
      { id: 'checkout', label: 'Checkout API', type: 'backend', stage: 0, tag: 'eventos' },
      { id: 'billing', label: 'Billing API', type: 'backend', stage: 0 },
      { id: 'bus', label: 'Event Bus', type: 'messagebus', sub: 'Kafka', stage: 1 },
      { id: 'proc', label: 'Stream Processor', type: 'backend', stage: 2 },
      { id: 'dw', label: 'Warehouse', type: 'database', sub: 'agregados', stage: 3 },
      { id: 'dash', label: 'Dashboard', type: 'frontend', stage: 3 }
    ],
    links: [
      'checkout -> bus: order.created {emphasis}',
      'billing -> bus: invoice.issued',
      'bus -> proc: consume',
      'proc -> dw: métricas',
      'proc -> dash: live {dashed}'
    ],
    cards: [
      { dot: 'emerald', title: 'Camino principal', items: ['Los datos fluyen de izquierda a derecha por etapas', 'Las etiquetas nombran activos, no verbos'] }
    ]
  },
  lifecycle: {
    title: 'Ciclo de despliegue (ejemplo completo)',
    nodes: [
      { id: 'queued', label: 'En cola', type: 'start', sub: 'aceptado', tag: 'entrada' },
      { id: 'build', label: 'Build', type: 'active', sub: 'compilando' },
      { id: 'approval', label: 'Aprobación', type: 'waiting', sub: 'espera consentimiento' },
      { id: 'deploy', label: 'Deploy', type: 'active', sub: 'rollout' },
      { id: 'done', label: 'Listo', type: 'success' }
    ],
    links: [
      'queued -> build',
      'build -> approval {security}',
      'approval -> deploy {emphasis}',
      'deploy -> done {return}'
    ],
    cards: [
      { dot: 'emerald', title: 'Camino principal', items: ['Cinco fases ordenadas de la cola a completado', 'La finalización es una fase, no una caja suelta'] }
    ]
  }
};

const pretty = (obj) => JSON.stringify(obj, null, 2);

export default function App() {
  const [type, setType] = useState('architecture');
  const [text, setText] = useState(pretty(TEMPLATES.architecture));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [currentId, setCurrentId] = useState(null);
  const [library, setLibrary] = useState([]);
  const debounceRef = useRef(null);
  const urlRef = useRef(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch(`${API}/diagrams`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setLibrary(json.diagrams ?? []);
    } catch { /* persistencia opcional */ }
  }, []);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  const render = useCallback(async (t, raw) => {
    let simple;
    try {
      simple = JSON.parse(raw);
    } catch (e) {
      setError(`JSON inválido: ${e.message}`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/render-simple/${t}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simple })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ? `${j.error}${j.detail ? ` — ${j.detail}` : ''}` : 'No se pudo renderizar');
        return;
      }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreviewUrl(url);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => render(type, text), 600);
    return () => clearTimeout(debounceRef.current);
  }, [type, text, render]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const changeType = (t) => {
    setType(t);
  };

  const loadExample = (t) => {
    const hasWork = text.trim() && text.trim() !== pretty(TEMPLATES[type]).trim();
    if (hasWork && !window.confirm('Esto reemplazará el JSON actual con el ejemplo. ¿Continuar?')) return;
    setCurrentId(null);
    setType(t);
    setText(pretty(TEMPLATES[t]));
  };

  const save = useCallback(async () => {
    let simple;
    try { simple = JSON.parse(text); } catch (e) { setError(`JSON inválido: ${e.message}`); return; }
    setBusy(true); setError(null);
    try {
      const name = simple.title ?? `${type} sin título`;
      const method = currentId ? 'PUT' : 'POST';
      const url = currentId ? `${API}/diagrams/${currentId}` : `${API}/diagrams`;
      const body = currentId ? { name, spec: simple } : { name, type, spec: simple };
      const json = await (await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (!json.ok) { setError(json.error ?? 'No se pudo guardar'); return; }
      setCurrentId(json.diagram.id);
      setSaved('guardado ✓'); setTimeout(() => setSaved(''), 2000);
      refreshLibrary();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [text, type, currentId, refreshLibrary]);

  const loadDiagram = useCallback(async (id) => {
    if (!id) return;
    setBusy(true); setError(null);
    try {
      const json = await (await fetch(`${API}/diagrams/${id}`)).json();
      if (!json.ok) { setError('No se pudo cargar'); return; }
      setCurrentId(id);
      setType(json.diagram.type);
      setText(pretty(json.diagram.spec));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, []);

  const deleteCurrent = useCallback(async () => {
    if (!currentId) return;
    setBusy(true); setError(null);
    try {
      await fetch(`${API}/diagrams/${currentId}`, { method: 'DELETE' });
      setCurrentId(null);
      refreshLibrary();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [currentId, refreshLibrary]);

  const exportHtml = useCallback(async () => {
    let simple;
    try { simple = JSON.parse(text); } catch (e) { setError(`JSON inválido: ${e.message}`); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/export-simple/${type}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simple })
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'No se pudo exportar'); return; }
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${(simple.title ?? 'diagrama').replace(/\s+/g, '-')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [text, type]);

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Archify Studio</strong>
        <span className="tag">JSON</span>
        <select value={type} onChange={(e) => changeType(e.target.value)} disabled={busy}>
          {DIAGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={currentId ?? ''} onChange={(e) => (e.target.value ? loadDiagram(e.target.value) : setCurrentId(null))} disabled={busy} title="Mis diagramas">
          <option value="">Mis diagramas…</option>
          {library.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.type}</option>)}
        </select>
        <button onClick={save} disabled={busy}>{currentId ? 'Guardar' : 'Guardar nuevo'}</button>
        {currentId && <button className="danger" onClick={deleteCurrent} disabled={busy}>Eliminar</button>}
        <button className="export" onClick={exportHtml} disabled={busy}>⬇ Exportar HTML</button>
        {busy && <span className="status">renderizando…</span>}
        {saved && <span className="status ok">{saved}</span>}
        {error && <span className="error">⚠ {error}</span>}
      </header>
      <div className="body">
        <div className="editor-pane">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className={error ? 'has-error' : ''}
          />
          <div className="examples">
            <span className="examples-title">Tipos de nodo ("type"):</span>
            {(NODE_TYPES_BY_DIAGRAM[type] ?? COMMON_NODE_TYPES).map((nt) => (
              <span key={nt} className={`node-type nt-${nt}`}>{nt}</span>
            ))}
            <button className="load-example" onClick={() => loadExample(type)} disabled={busy}>Cargar ejemplo</button>
          </div>
        </div>
        <div className="preview-pane">
          {previewUrl
            ? <iframe title="preview" src={previewUrl} />
            : <div className="preview-empty">Escribe el JSON a la izquierda para ver el diagrama.</div>}
        </div>
      </div>
    </div>
  );
}
