/* =====================================================================
   mktscaled-listings — Panel SPA
   React 18 UMD + htm (sin build step).
   ===================================================================== */
(function () {
  'use strict';
  const { createElement: h, useState, useEffect, useCallback, useMemo, useRef, Fragment } = React;
  const html = htm.bind(h);

  // -------------------------------------------------------------------
  // API helper
  // -------------------------------------------------------------------
  const API = '/api';
  let _token = null;
  function setToken(t) { _token = t; }
  async function api(path, opts = {}) {
    const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, { ...opts, headers });
    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch { err = { error: 'http_' + res.status }; }
      const e = new Error(err.error || ('HTTP ' + res.status));
      e.detail = err;
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  // -------------------------------------------------------------------
  // Toast (mini)
  // -------------------------------------------------------------------
  const toastState = { id: 0, listeners: new Set() };
  function toast(msg, kind) {
    toastState.id += 1;
    const id = toastState.id;
    const entry = { id, msg, kind: kind || '' };
    toastState.listeners.forEach((fn) => fn(entry));
    setTimeout(() => toastState.listeners.forEach((fn) => fn({ id, remove: true })), 3500);
  }
  function Toaster() {
    const [items, setItems] = useState([]);
    useEffect(() => {
      const fn = (e) => {
        if (e.remove) setItems((x) => x.filter((i) => i.id !== e.id));
        else setItems((x) => [...x, e]);
      };
      toastState.listeners.add(fn);
      return () => toastState.listeners.delete(fn);
    }, []);
    return html`<${Fragment}>${items.map((i) => html`<div key=${i.id} className=${'toast ' + i.kind}>${i.msg}</div>`)}<//>`;
  }

  // -------------------------------------------------------------------
  // Form schema — replica el Master Context v2.6 y matchea ghl-field-ids.json
  // -------------------------------------------------------------------
  const AMENIDADES = ['Alberca','Gym','Roof garden','Vigilancia 24h','Elevador','Área BBQ','Jardín','Salón de eventos','Beach Club','Acceso a playa','Cancha','Spa','Golf','Kids area','Restaurante-Bar','Intercomunicador','Portón eléctrico'];

  const SECTIONS = [
    { title: 'Información general', fields: [
      { key: 'titulo', label: 'Título', type: 'text', required: true, maxLength: 100, span: 2 },
      { key: 'descripcion', label: 'Descripción', type: 'textarea', required: true, full: true },
      { key: 'tipo_operacion', label: 'Tipo de operación', type: 'select', required: true, options: ['Venta','Renta'] },
      { key: 'tipo_inmueble', label: 'Tipo de inmueble', type: 'select', required: true, options: ['Casa','Departamento','Local','Terreno','Oficina','Bodega','Villa','Penthouse'] },
      { key: 'estado', label: 'Estado', type: 'select', required: true, options: ['Disponible','Vendida','Rentada','Pausada'], defaultValue: 'Disponible' },
      { key: 'etiqueta', label: 'Etiqueta', type: 'select', options: ['','Destacada','Nueva','Oportunidad','Preventa','Remate'] },
      { key: 'preventa', label: 'Preventa', type: 'toggle' },
      { key: 'fecha_entrega', label: 'Fecha estimada de entrega', type: 'date', showIf: (s) => s.preventa },
      { key: 'agente_responsable', label: 'Agente responsable', type: 'agent', required: true },
    ]},
    { title: 'Precio', fields: [
      { key: 'precio_usd', label: 'Precio USD', type: 'number', required: true },
      { key: 'precio_mxn', label: 'Precio MXN', type: 'number' },
      { key: 'cuota_mantenimiento', label: 'Cuota mantenimiento (MXN/mes)', type: 'number' },
      { key: 'precio_a_consultar', label: 'Precio a consultar (oculta precio)', type: 'toggle' },
      { key: 'nota_precio', label: 'Nota de precio', type: 'text', span: 2 },
    ]},
    { title: 'Ubicación', fields: [
      { key: 'direccion_completa', label: 'Dirección completa (autocompleta colonia, ciudad, estado, CP)', type: 'places', required: true, full: true },
      { key: 'colonia', label: 'Colonia / Zona', type: 'text', required: true },
      { key: 'ciudad', label: 'Ciudad', type: 'text', required: true },
      { key: 'estado_municipio', label: 'Estado / Municipio', type: 'text', required: true },
      { key: 'codigo_postal', label: 'Código postal', type: 'text' },
      { key: 'latitud', label: 'Latitud', type: 'number', readOnly: true },
      { key: 'longitud', label: 'Longitud', type: 'number', readOnly: true },
      { key: 'ocultar_direccion', label: 'Ocultar dirección exacta al público', type: 'toggle' },
      { key: 'zona_federal', label: 'Zona Federal (playa)', type: 'toggle' },
    ]},
    { title: 'Dimensiones', fields: [
      { key: 'm2_construccion', label: 'm² construcción', type: 'number', required: true },
      { key: 'm2_terreno', label: 'm² terreno', type: 'number' },
      { key: 'nombre_condominio', label: 'Nombre del condominio', type: 'text' },
      { key: 'niveles', label: 'Niveles', type: 'number' },
      { key: 'piso_edificio', label: 'Piso en edificio', type: 'number' },
      { key: 'anio_construccion', label: 'Año de construcción', type: 'number' },
    ]},
    { title: 'Habitaciones', fields: [
      { key: 'recamaras', label: 'Recámaras', type: 'number', required: true },
      { key: 'banos_completos', label: 'Baños completos', type: 'number', required: true },
      { key: 'medios_banos', label: 'Medios baños', type: 'number' },
      { key: 'estacionamientos', label: 'Estacionamientos', type: 'number', required: true },
      { key: 'cuarto_servicio', label: 'Cuarto de servicio', type: 'toggle' },
      { key: 'bodega_storage', label: 'Bodega / Storage', type: 'toggle' },
    ]},
    { title: 'Amenidades', fields: [
      { key: 'amenidades', label: 'Selecciona las amenidades disponibles', type: 'amenities', full: true },
      { key: 'vista_principal', label: 'Vista principal', type: 'select', options: ['','Calle','Mar','Jardín','Montaña','Ciudad','Laguna','Campo de golf'] },
      { key: 'vista_secundaria', label: 'Vista secundaria', type: 'text' },
      { key: 'aire_acondicionado', label: 'Aire acondicionado', type: 'toggle' },
    ]},
    { title: 'Fotos y media', fields: [
      { key: 'fotos_urls', label: 'Fotos (arrastra para reordenar — la 1ª es la portada)', type: 'photos', required: true, full: true },
      { key: 'video_url', label: 'Video URL (YouTube/Vimeo)', type: 'text' },
      { key: 'tour_virtual_url', label: 'Tour virtual URL (Matterport)', type: 'text' },
      { key: 'planos_url', label: 'Planos URL', type: 'text' },
    ]},
    { title: 'CTA y colecciones', fields: [
      { key: 'cta_tipo', label: 'CTA de la propiedad', type: 'select', options: ['global','whatsapp','formulario','redirect'], defaultValue: 'global' },
      { key: 'cta_valor', label: 'Valor del CTA (número, snippet o URL)', type: 'text', showIf: (s) => s.cta_tipo && s.cta_tipo !== 'global', span: 2 },
      { key: '_collections', label: 'Asignar a colecciones', type: 'collections', full: true },
    ]},
  ];

  // Convierte el state del form -> payload listo para POST /api/property
  function serializeForm(state) {
    const out = {};
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        if (f.key === '_collections') {
          out._collections = state._collections || [];
          continue;
        }
        const v = state[f.key];
        if (v == null || v === '') continue;
        if (f.type === 'toggle') {
          out[f.key] = v ? 'Sí' : '';
        } else if (f.type === 'amenities') {
          out[f.key] = Array.isArray(v) ? v.join(',') : '';
        } else if (f.type === 'photos') {
          out[f.key] = Array.isArray(v) ? v.join('|') : '';
        } else if (f.type === 'number') {
          out[f.key] = Number(v);
        } else {
          out[f.key] = v;
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Bootstrap: SSO + runtime config + agents + collections
  // -------------------------------------------------------------------
  function useBootstrap() {
    const [state, setState] = useState({ loading: true, error: null });
    useEffect(() => {
      (async () => {
        try {
          const params = new URLSearchParams(window.location.search);
          const locationId = params.get('locationId');
          const userId = params.get('userId');
          if (!locationId || !userId) {
            throw new Error('Faltan locationId o userId en la URL. Abre el panel desde GHL.');
          }
          const sso = await fetch(`${API}/auth/sso?locationId=${encodeURIComponent(locationId)}&userId=${encodeURIComponent(userId)}`).then((r) => r.json());
          if (!sso.token) throw new Error(sso.error || 'sso_failed');
          setToken(sso.token);
          const [config, agentsData, collectionsData] = await Promise.all([
            api('/runtime-config'),
            api('/agent'),
            api('/collection'),
          ]);
          setState({
            loading: false, error: null,
            session: sso, config,
            agentes: agentsData.agentes || [],
            colecciones: collectionsData.colecciones || [],
          });
        } catch (e) {
          setState({ loading: false, error: e.message || String(e) });
        }
      })();
    }, []);
    return state;
  }

  // -------------------------------------------------------------------
  // Google Places loader (carga el script una vez)
  // -------------------------------------------------------------------
  let _mapsPromise = null;
  function loadGoogleMaps(apiKey) {
    if (!apiKey) return Promise.reject(new Error('GOOGLE_MAPS_API_KEY no configurada'));
    if (window.google?.maps?.places) return Promise.resolve();
    if (_mapsPromise) return _mapsPromise;
    _mapsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No pude cargar Google Maps JS'));
      document.head.appendChild(s);
    });
    return _mapsPromise;
  }

  // -------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------
  function Sidebar({ page, setPage, agente, tenant, openMobile, setMobile }) {
    const items = [
      { id: 'dashboard', label: 'Dashboard', icon: '◧' },
      { id: 'new', label: 'Nueva propiedad', icon: '＋' },
      { id: 'listings', label: 'Mis listings', icon: '☰' },
      { id: 'collections', label: 'Colecciones', icon: '◆' },
      { id: 'team', label: 'Mi equipo', icon: '◉', adminOnly: true },
      { id: 'settings', label: 'Configuración', icon: '⚙' },
    ];
    return html`
      <aside className=${'sidebar' + (openMobile ? ' open' : '')}>
        <div className="sidebar-brand">mktscaled<small>${tenant?.plan?.toUpperCase() || 'PLAN'}</small></div>
        <nav className="sidebar-nav">
          ${items.filter((i) => !i.adminOnly || agente?.rol === 'admin').map((i) => html`
            <button key=${i.id} className=${page === i.id ? 'active' : ''} onClick=${() => { setPage(i.id); setMobile(false); }}>
              <span className="icon">${i.icon}</span>${i.label}
            </button>
          `)}
        </nav>
        <div className="sidebar-foot">
          <div className="user-name">${agente?.nombre || 'Agente'}</div>
          <div className=${'user-rol ' + (agente?.rol || '')}>${agente?.rol || ''}</div>
        </div>
      </aside>
    `;
  }

  function Field({ field, state, set, ctx }) {
    if (field.showIf && !field.showIf(state)) return null;
    const value = state[field.key];
    const span = field.full ? 'full' : (field.span === 2 ? 'span-2' : '');
    const label = html`<label className="form-label" htmlFor=${field.key}>${field.label}${field.required ? html` <span className="req">*</span>` : null}</label>`;

    let control;
    switch (field.type) {
      case 'text':
      case 'date':
        control = html`<input id=${field.key} className="form-input" type=${field.type === 'date' ? 'date' : 'text'} value=${value || ''} maxLength=${field.maxLength} readOnly=${field.readOnly} onInput=${(e) => set(field.key, e.target.value)} />`;
        break;
      case 'number':
        control = html`<input id=${field.key} className="form-input" type="number" step="any" value=${value ?? ''} readOnly=${field.readOnly} onInput=${(e) => set(field.key, e.target.value)} />`;
        break;
      case 'textarea':
        control = html`<textarea id=${field.key} className="form-textarea" rows="4" value=${value || ''} onInput=${(e) => set(field.key, e.target.value)} />`;
        break;
      case 'select':
        control = html`<select id=${field.key} className="form-select" value=${value || ''} onChange=${(e) => set(field.key, e.target.value)}>
          ${field.options.map((opt) => html`<option key=${opt} value=${opt}>${opt || '— ninguno —'}</option>`)}
        </select>`;
        break;
      case 'toggle':
        return html`<div className=${'form-field ' + span}>
          <label className="toggle">
            <input type="checkbox" checked=${!!value} onChange=${(e) => set(field.key, e.target.checked)} />
            <span className="track"></span>
            <span className="toggle-label">${field.label}</span>
          </label>
        </div>`;
      case 'agent':
        control = html`<select id=${field.key} className="form-select" value=${value || ''} onChange=${(e) => set(field.key, e.target.value)}>
          <option value="">— Selecciona agente —</option>
          ${ctx.agentes.map((a) => html`<option key=${a.ghl_user_id} value=${a.ghl_user_id}>${a.nombre}${a.rol === 'admin' ? ' (admin)' : ''}</option>`)}
        </select>`;
        break;
      case 'places':
        control = html`<${PlacesInput} value=${value || ''} apiKey=${ctx.googleMapsApiKey} onPlace=${(p) => {
          set(field.key, p.formatted);
          if (p.colonia) set('colonia', p.colonia);
          if (p.ciudad) set('ciudad', p.ciudad);
          if (p.estado) set('estado_municipio', p.estado);
          if (p.cp) set('codigo_postal', p.cp);
          if (p.lat) set('latitud', p.lat);
          if (p.lng) set('longitud', p.lng);
        }} />`;
        break;
      case 'amenities':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <div className="amen-grid">
            ${AMENIDADES.map((opt) => {
              const checked = Array.isArray(value) && value.includes(opt);
              return html`<label key=${opt} className=${'amen-item' + (checked ? ' checked' : '')}>
                <input type="checkbox" checked=${checked} onChange=${(e) => {
                  const arr = Array.isArray(value) ? [...value] : [];
                  if (e.target.checked) arr.push(opt); else arr.splice(arr.indexOf(opt), 1);
                  set(field.key, arr);
                }} />${opt}
              </label>`;
            })}
          </div>
        </div>`;
      case 'photos':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <${PhotosInput} value=${value || []} onChange=${(arr) => set(field.key, arr)} />
        </div>`;
      case 'collections':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <div className="coll-list">
            ${ctx.colecciones.length === 0 ? html`<span className="form-help">Aún no tienes colecciones — créalas en el menú "Colecciones".</span>` : null}
            ${ctx.colecciones.map((c) => {
              const sel = (state._collections || []).includes(c.id);
              return html`<span key=${c.id} className=${'coll-pill' + (sel ? ' selected' : '')} onClick=${() => {
                const arr = [...(state._collections || [])];
                const i = arr.indexOf(c.id);
                if (i >= 0) arr.splice(i, 1); else arr.push(c.id);
                set('_collections', arr);
              }}>${c.nombre}</span>`;
            })}
          </div>
        </div>`;
      default:
        control = html`<input className="form-input" value=${value || ''} onInput=${(e) => set(field.key, e.target.value)} />`;
    }
    return html`<div className=${'form-field ' + span}>${label}${control}</div>`;
  }

  function PlacesInput({ value, apiKey, onPlace }) {
    const ref = useRef(null);
    useEffect(() => {
      if (!apiKey) return;
      let ac;
      loadGoogleMaps(apiKey).then(() => {
        if (!ref.current) return;
        ac = new window.google.maps.places.Autocomplete(ref.current, { fields: ['formatted_address', 'geometry', 'address_components'] });
        ac.addListener('place_changed', () => {
          const p = ac.getPlace();
          if (!p?.geometry) return;
          const parts = {};
          (p.address_components || []).forEach((c) => {
            if (c.types.includes('sublocality') || c.types.includes('neighborhood')) parts.colonia = c.long_name;
            if (c.types.includes('locality')) parts.ciudad = c.long_name;
            if (c.types.includes('administrative_area_level_1')) parts.estado = c.long_name;
            if (c.types.includes('postal_code')) parts.cp = c.long_name;
          });
          onPlace({
            formatted: p.formatted_address,
            lat: p.geometry.location.lat(),
            lng: p.geometry.location.lng(),
            ...parts,
          });
        });
      }).catch(() => { /* no-op */ });
      return () => { if (ac) window.google?.maps?.event?.clearInstanceListeners(ac); };
    }, [apiKey]);
    return html`<input ref=${ref} className="form-input" placeholder=${apiKey ? 'Empieza a escribir la dirección…' : 'Google Maps no configurado'} defaultValue=${value} />`;
  }

  function PhotosInput({ value, onChange }) {
    const [uploading, setUploading] = useState(0);
    const dragIdx = useRef(null);

    const uploadFiles = async (files) => {
      const arr = Array.from(files);
      if (!arr.length) return;
      setUploading((n) => n + arr.length);
      try {
        const sign = await api('/upload/sign', { method: 'POST', body: { kind: 'property' } });
        const uploaded = [];
        for (const file of arr) {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('api_key', sign.apiKey);
          fd.append('timestamp', sign.timestamp);
          fd.append('folder', sign.folder);
          fd.append('eager', sign.eager);
          fd.append('signature', sign.signature);
          const r = await fetch(sign.uploadUrl, { method: 'POST', body: fd });
          if (!r.ok) { toast('Error subiendo foto', 'error'); continue; }
          const j = await r.json();
          // Preferimos la URL WebP eager si Cloudinary la generó; si no, secure_url
          const eagerUrl = j.eager?.[0]?.secure_url || j.eager?.[0]?.url || j.secure_url;
          uploaded.push(eagerUrl);
          setUploading((n) => n - 1);
        }
        if (uploaded.length) onChange([...(value || []), ...uploaded]);
      } catch (e) {
        toast('Falló el upload: ' + (e.detail?.hint || e.message), 'error');
        setUploading(0);
      }
    };

    const removeAt = (i) => {
      const arr = [...value];
      arr.splice(i, 1);
      onChange(arr);
    };

    const onDragStart = (i) => (e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; };
    const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const onDrop = (i) => (e) => {
      e.preventDefault();
      const from = dragIdx.current;
      if (from == null || from === i) return;
      const arr = [...value];
      const [moved] = arr.splice(from, 1);
      arr.splice(i, 0, moved);
      onChange(arr);
      dragIdx.current = null;
    };

    return html`
      <div className="photos">
        ${(value || []).map((url, i) => html`
          <div key=${url} className="photo-thumb" draggable=${true} onDragStart=${onDragStart(i)} onDragOver=${onDragOver} onDrop=${onDrop(i)}>
            <img src=${url} alt="" />
            ${i === 0 ? html`<span className="badge">PORTADA</span>` : null}
            <button className="rm" type="button" onClick=${() => removeAt(i)} title="Quitar">×</button>
          </div>
        `)}
        <label className="photo-uploader">
          <input type="file" accept="image/*" multiple onChange=${(e) => uploadFiles(e.target.files)} />
          <div>＋ Agregar</div>
          <div style=${{ fontSize: '11px' }}>JPG, PNG, WebP, HEIC</div>
        </label>
      </div>
      ${uploading > 0 ? html`<div className="photo-uploading">Subiendo ${uploading} foto(s)…</div>` : null}
    `;
  }

  // -------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------
  function NewPropertyPage({ ctx }) {
    const initial = useMemo(() => {
      const s = { _collections: [] };
      for (const sec of SECTIONS) for (const f of sec.fields) {
        if (f.defaultValue != null) s[f.key] = f.defaultValue;
      }
      return s;
    }, []);
    const [state, setState] = useState(initial);
    const [saving, setSaving] = useState(false);
    const set = useCallback((k, v) => setState((s) => ({ ...s, [k]: v })), []);

    const onSubmit = async (e) => {
      e.preventDefault();
      // Validación mínima de campos requeridos
      for (const sec of SECTIONS) for (const f of sec.fields) {
        if (!f.required) continue;
        if (f.showIf && !f.showIf(state)) continue;
        const v = state[f.key];
        const isEmpty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
        if (isEmpty) { toast('Falta: ' + f.label, 'error'); return; }
      }
      setSaving(true);
      try {
        const payload = serializeForm(state);
        const resp = await api('/property', { method: 'POST', body: payload });
        toast('Propiedad creada ✓', 'success');
        setState({ ...initial });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        toast('Error al crear: ' + (err.detail?.error || err.message), 'error');
      } finally {
        setSaving(false);
      }
    };

    return html`
      <div className="page-header">
        <div>
          <h1 className="page-title">Nueva propiedad</h1>
          <p className="page-subtitle">Completa los campos. Se publicará en tu portal y queda lista para compartir.</p>
        </div>
      </div>
      <form onSubmit=${onSubmit}>
        ${SECTIONS.map((sec) => html`
          <div className="card" key=${sec.title}>
            <div className="card-header">${sec.title}</div>
            <div className="form-grid">
              ${sec.fields.map((f) => html`<${Field} key=${f.key} field=${f} state=${state} set=${set} ctx=${ctx} />`)}
            </div>
          </div>
        `)}
        <div className="action-bar">
          <button type="button" className="btn btn-ghost" disabled=${saving} onClick=${() => setState({ ...initial })}>Limpiar</button>
          <button type="submit" className="btn btn-primary" disabled=${saving}>${saving ? 'Guardando…' : 'Publicar propiedad'}</button>
        </div>
      </form>
    `;
  }

  function Placeholder({ title, subtitle }) {
    return html`<div className="placeholder">
      <h2>${title}</h2>
      <p>${subtitle}</p>
    </div>`;
  }

  function Dashboard({ ctx }) {
    return html`<${Fragment}>
      <div className="page-header"><div><h1 className="page-title">Dashboard</h1><p className="page-subtitle">Resumen rápido de tu inventario.</p></div></div>
      <div className="card"><strong>Plan:</strong> ${ctx.tenant?.plan?.toUpperCase()} · <strong>Agentes activos:</strong> ${ctx.agentes.length} · <strong>Colecciones:</strong> ${ctx.colecciones.length}</div>
      <${Placeholder} title="Próximamente" subtitle="Métricas de vistas y top 5 propiedades llegan en una próxima iteración." />
    <//>`;
  }

  // -------------------------------------------------------------------
  // App root
  // -------------------------------------------------------------------
  function App() {
    const boot = useBootstrap();
    const [page, setPage] = useState('new');
    const [mobile, setMobile] = useState(false);

    if (boot.loading) return html`<div className="boot"><div className="boot-spinner"></div><div className="boot-text">Cargando panel…</div></div>`;
    if (boot.error) return html`<div className="boot"><div className="boot-text" style=${{ color: '#dc2626' }}>${boot.error}</div></div>`;

    const ctx = {
      agentes: boot.agentes,
      colecciones: boot.colecciones,
      googleMapsApiKey: boot.config.googleMapsApiKey,
      tenant: boot.session.tenant,
    };

    let body;
    switch (page) {
      case 'dashboard': body = html`<${Dashboard} ctx=${ctx} />`; break;
      case 'new': body = html`<${NewPropertyPage} ctx=${ctx} />`; break;
      case 'listings': body = html`<${Placeholder} title="Mis listings" subtitle="La tabla con búsqueda y filtros está lista para construirse sobre /api/property." />`; break;
      case 'collections': body = html`<${Placeholder} title="Colecciones" subtitle="Crear, renombrar y copiar URLs de colecciones — endpoints listos en /api/collection." />`; break;
      case 'team': body = html`<${Placeholder} title="Mi equipo" subtitle="Gestión de agentes con límites por plan. /api/agent ya devuelve la lista." />`; break;
      case 'settings': body = html`<${Placeholder} title="Configuración" subtitle="Marca, dominio y widget de contacto. Próxima iteración." />`; break;
      default: body = null;
    }

    return html`
      <div className="app">
        <div className="mobile-bar">
          <button onClick=${() => setMobile(true)}>☰</button>
          <span className="title">mktscaled</span>
        </div>
        ${mobile ? html`<div className="backdrop" onClick=${() => setMobile(false)}></div>` : null}
        <${Sidebar} page=${page} setPage=${setPage} agente=${boot.session.agente} tenant=${boot.session.tenant} openMobile=${mobile} setMobile=${setMobile} />
        <main className="content">${body}</main>
        <${Toaster} />
      </div>
    `;
  }

  // Reveal mobile bar via CSS @media only — we don't toggle from JS.
  // Mount.
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(html`<${App} />`);
})();
