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
            portal: collectionsData.portal || { subdominio: null, activo: false },
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
    // Fallback: si el agente escribe manualmente (sin seleccionar de Autocomplete,
    // o cuando GOOGLE_MAPS_API_KEY no está configurada), igual actualizamos el
    // state del form. Autocomplete sólo enriquece: cuando dispara place_changed
    // sobreescribe con la dirección estructurada + lat/lng.
    return html`<input ref=${ref} className="form-input" placeholder=${apiKey ? 'Empieza a escribir la dirección…' : 'Escribe la dirección manualmente (Google Maps no configurado)'} value=${value || ''} onInput=${(e) => onPlace({ formatted: e.target.value })} />`;
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
          if (!r.ok) { toast('Error subiendo foto', 'error'); setUploading((n) => n - 1); continue; }
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
  // CollectionsPage — Paso 7
  // -------------------------------------------------------------------
  function CollectionsPage({ ctx }) {
    const [editing, setEditing] = useState(null); // null | { id?, nombre, foto_url }
    const [openMenuId, setOpenMenuId] = useState(null);

    // Cierra el menú flotante al click fuera
    useEffect(() => {
      const onDocClick = () => setOpenMenuId(null);
      document.addEventListener('click', onDocClick);
      return () => document.removeEventListener('click', onDocClick);
    }, []);

    const buildUrl = (slug) => {
      const host = ctx.portal?.subdominio;
      if (!host) return null;
      return `https://${host}/coleccion/${slug}`;
    };

    const copyUrl = async (url) => {
      if (!url) { toast('Configura tu dominio en Settings para tener URL pública', 'error'); return; }
      try {
        await navigator.clipboard.writeText(url);
        toast('URL copiada ✓', 'success');
      } catch {
        toast('No pude copiar — selecciona y copia manualmente', 'error');
      }
    };

    const onDelete = async (col) => {
      if (col.propiedades_count > 0) {
        if (!confirm(`"${col.nombre}" tiene ${col.propiedades_count} propiedad(es) asignadas. Eliminarla NO borra las propiedades, sólo la colección. ¿Continuar?`)) return;
      } else if (!confirm(`Eliminar la colección "${col.nombre}"?`)) {
        return;
      }
      try {
        await api(`/collection/${col.id}`, { method: 'DELETE' });
        await ctx.reloadCollections();
        toast('Colección eliminada', 'success');
      } catch (e) {
        toast('Error al eliminar: ' + (e.detail?.message || e.message), 'error');
      }
    };

    return html`<${Fragment}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Colecciones</h1>
          <p className="page-subtitle">Agrupa propiedades en colecciones libres — zona, desarrollo, campaña — y comparte la URL a discreción.</p>
        </div>
        <button data-testid="new-collection-btn" className="btn btn-primary" onClick=${() => setEditing({ nombre: '', foto_url: '' })}>＋ Nueva colección</button>
      </div>

      ${ctx.colecciones.length === 0 ? html`
        <div className="card">
          <div className="empty-state">
            <h3>Aún no tienes colecciones</h3>
            <p>Crea tu primera colección para agrupar propiedades por zona, tipo, desarrollo o campaña.</p>
            <button className="btn btn-primary" onClick=${() => setEditing({ nombre: '', foto_url: '' })}>Crear primera colección</button>
          </div>
        </div>
      ` : html`
        <div className="coll-grid">
          ${ctx.colecciones.map((c) => {
            const url = buildUrl(c.slug);
            const menuOpen = openMenuId === c.id;
            return html`<div key=${c.id} className="coll-card" data-testid=${'collection-card-' + c.slug}>
              <div className="coll-card-cover">
                ${c.foto_url
                  ? html`<img src=${c.foto_url} alt=${c.nombre} />`
                  : html`<div className="coll-card-cover-placeholder">${c.nombre.charAt(0).toUpperCase()}</div>`}
                <button
                  data-testid=${'collection-menu-' + c.slug}
                  className="coll-card-menu"
                  onClick=${(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : c.id); }}
                  title="Más acciones"
                >···</button>
                ${menuOpen ? html`<div className="coll-card-menu-pop" onClick=${(e) => e.stopPropagation()}>
                  <button onClick=${() => { setEditing({ ...c }); setOpenMenuId(null); }}>Renombrar / Cambiar foto</button>
                  <button onClick=${() => { copyUrl(url); setOpenMenuId(null); }}>Copiar URL</button>
                  ${url ? html`<a href=${url} target="_blank" rel="noreferrer" onClick=${() => setOpenMenuId(null)}>Abrir en pestaña</a>` : null}
                  <button className="danger" onClick=${() => { setOpenMenuId(null); onDelete(c); }}>Eliminar</button>
                </div>` : null}
              </div>
              <div className="coll-card-body">
                <div className="coll-card-name">${c.nombre}</div>
                <div className="coll-card-meta">
                  <span>${c.propiedades_count} propiedad${c.propiedades_count === 1 ? '' : 'es'}</span>
                  <span className="dot">·</span>
                  <code>/${c.slug}</code>
                </div>
                <div className="coll-card-url" title=${url || 'Configura tu dominio'}>
                  ${url ? url : html`<em>Configura tu dominio en Settings</em>`}
                </div>
                <div className="coll-card-actions">
                  <button data-testid=${'copy-url-' + c.slug} className="btn btn-ghost" onClick=${() => copyUrl(url)} disabled=${!url}>Copiar URL</button>
                  <button data-testid=${'edit-' + c.slug} className="btn btn-ghost" onClick=${() => setEditing({ ...c })}>Editar</button>
                </div>
              </div>
            </div>`;
          })}
        </div>
      `}

      ${editing ? html`<${CollectionModal}
        initial=${editing}
        onClose=${() => setEditing(null)}
        onSaved=${async () => { await ctx.reloadCollections(); setEditing(null); }}
      />` : null}
    <//>`;
  }

  // Modal crear/editar colección
  function CollectionModal({ initial, onClose, onSaved }) {
    const isEdit = !!initial.id;
    const [nombre, setNombre] = useState(initial.nombre || '');
    const [fotoUrl, setFotoUrl] = useState(initial.foto_url || '');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);

    const onUpload = async (file) => {
      if (!file) return;
      setUploading(true);
      try {
        const sign = await api('/upload/sign', { method: 'POST', body: { kind: 'collection' } });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('api_key', sign.apiKey);
        fd.append('timestamp', sign.timestamp);
        fd.append('folder', sign.folder);
        fd.append('eager', sign.eager);
        fd.append('signature', sign.signature);
        const r = await fetch(sign.uploadUrl, { method: 'POST', body: fd });
        if (!r.ok) throw new Error('upload_failed');
        const j = await r.json();
        const url = j.eager?.[0]?.secure_url || j.secure_url;
        setFotoUrl(url);
      } catch (e) {
        toast('Error subiendo foto: ' + (e.message || e), 'error');
      } finally {
        setUploading(false);
      }
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      const trimmed = nombre.trim();
      if (!trimmed) { toast('Falta el nombre', 'error'); return; }
      setSaving(true);
      try {
        if (isEdit) {
          await api('/collection/' + initial.id, { method: 'PUT', body: { nombre: trimmed, foto_url: fotoUrl || null } });
          toast('Colección actualizada ✓', 'success');
        } else {
          await api('/collection', { method: 'POST', body: { nombre: trimmed, foto_url: fotoUrl || null } });
          toast('Colección creada ✓', 'success');
        }
        await onSaved();
      } catch (err) {
        toast('Error al guardar: ' + (err.detail?.message || err.message), 'error');
      } finally {
        setSaving(false);
      }
    };

    return html`<div className="modal-backdrop" onClick=${onClose}>
      <div className="modal" onClick=${(e) => e.stopPropagation()} data-testid="collection-modal">
        <div className="modal-header">
          <h2>${isEdit ? 'Editar colección' : 'Nueva colección'}</h2>
          <button className="modal-close" onClick=${onClose}>×</button>
        </div>
        <form onSubmit=${onSubmit} className="modal-body">
          <div className="form-field full">
            <label className="form-label" htmlFor="coll-name">Nombre <span className="req">*</span></label>
            <input
              data-testid="collection-name-input"
              id="coll-name"
              className="form-input"
              value=${nombre}
              onInput=${(e) => setNombre(e.target.value)}
              placeholder="Ej. Zona Hotelera Cancún"
              autoFocus
            />
            <span className="form-help">El URL slug se genera automáticamente.</span>
          </div>

          <div className="form-field full">
            <label className="form-label">Foto (opcional)</label>
            <div className="coll-photo-uploader">
              ${fotoUrl ? html`<div className="coll-photo-preview">
                <img src=${fotoUrl} alt="" />
                <button type="button" className="rm" onClick=${() => setFotoUrl('')}>×</button>
              </div>` : null}
              <label className="photo-uploader" style=${{ width: fotoUrl ? '120px' : '100%' }}>
                <input type="file" accept="image/*" onChange=${(e) => onUpload(e.target.files[0])} />
                <div>${uploading ? 'Subiendo…' : (fotoUrl ? '↺ Reemplazar' : '＋ Subir foto')}</div>
              </label>
            </div>
          </div>

          <div className="action-bar" style=${{ position: 'static', margin: '12px -24px -20px' }}>
            <button type="button" className="btn btn-ghost" onClick=${onClose} disabled=${saving}>Cancelar</button>
            <button type="submit" data-testid="collection-save-btn" className="btn btn-primary" disabled=${saving || uploading}>${saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear colección')}</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  // -------------------------------------------------------------------
  // TeamPage — Paso 8 (admin only)
  // -------------------------------------------------------------------
  function TeamPage({ ctx }) {
    const [loading, setLoading] = useState(true);
    const [agentes, setAgentes] = useState([]);
    const [planInfo, setPlanInfo] = useState({ name: '', limit: null, activeCount: 0, canAdd: true });
    const [editing, setEditing] = useState(null);

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        const d = await api('/agent?team=1');
        setAgentes(d.agentes || []);
        setPlanInfo(d.plan || { name: '', limit: null, activeCount: 0, canAdd: true });
      } catch (e) {
        toast('No pude cargar el equipo: ' + (e.detail?.message || e.message), 'error');
      } finally { setLoading(false); }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const onToggleActive = async (a) => {
      try {
        await api('/agent/' + a.id, { method: 'PUT', body: { activo: !a.activo } });
        toast(a.activo ? 'Agente desactivado' : 'Agente reactivado ✓', 'success');
        await reload();
      } catch (e) {
        toast(e.detail?.message || 'Error al actualizar', 'error');
      }
    };

    const planLabel = planInfo.limit == null
      ? `${planInfo.activeCount} agente${planInfo.activeCount === 1 ? '' : 's'} activo${planInfo.activeCount === 1 ? '' : 's'} (ilimitado)`
      : `${planInfo.activeCount} de ${planInfo.limit} agente${planInfo.limit === 1 ? '' : 's'} activos`;

    return html`<${Fragment}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi equipo</h1>
          <p className="page-subtitle">Gestiona los agentes que pueden subir propiedades y aparecen en las páginas públicas.</p>
        </div>
        <button
          data-testid="new-agent-btn"
          className="btn btn-primary"
          onClick=${() => setEditing({ rol: 'agente', activo: true })}
          disabled=${!planInfo.canAdd}
          title=${!planInfo.canAdd ? `Tu plan ${planInfo.name?.toUpperCase()} no permite más agentes` : ''}
        >＋ Agregar agente</button>
      </div>

      <div className="card plan-bar" data-testid="plan-bar">
        <div className="plan-bar-info">
          <strong>Plan ${planInfo.name?.toUpperCase() || '—'}</strong>
          <span>${planLabel}</span>
        </div>
        ${!planInfo.canAdd ? html`<span className="plan-bar-warn">Límite alcanzado — actualiza tu plan para agregar más</span>` : null}
      </div>

      ${loading ? html`<div className="card">Cargando equipo…</div>` : (
        agentes.length === 0 ? html`
          <div className="card">
            <div className="empty-state">
              <h3>Aún no tienes miembros</h3>
              <p>Agrega al primer integrante de tu equipo para asignarle propiedades.</p>
            </div>
          </div>
        ` : html`
          <div className="team-grid">
            ${agentes.map((a) => html`<div key=${a.id} className=${'agent-card' + (a.activo ? '' : ' inactive')} data-testid=${'agent-card-' + a.id}>
              <div className="agent-card-photo">
                ${a.foto_url
                  ? html`<img src=${a.foto_url} alt=${a.nombre} />`
                  : html`<div className="agent-card-photo-placeholder">${(a.nombre || '?').charAt(0).toUpperCase()}</div>`}
                ${a.activo ? null : html`<span className="agent-badge-inactive">Inactivo</span>`}
              </div>
              <div className="agent-card-body">
                <div className="agent-card-name">${a.nombre}</div>
                <div className=${'agent-card-role ' + a.rol}>${a.rol === 'admin' ? 'Administrador' : 'Agente'}</div>
                <div className="agent-card-meta">
                  ${a.email ? html`<div>${a.email}</div>` : null}
                  ${a.telefono ? html`<div>${a.telefono}</div>` : null}
                </div>
                <div className="agent-card-stats">
                  <span><strong>${a.propiedades_count}</strong> propiedad${a.propiedades_count === 1 ? '' : 'es'}</span>
                  ${a.pending_ghl ? html`<span className="agent-badge-pending" title="Este agente aún no se ha conectado vía GHL — el ghl_user_id es temporal.">Pendiente GHL</span>` : null}
                </div>
                <div className="agent-card-actions">
                  <button data-testid=${'edit-agent-' + a.id} className="btn btn-ghost" onClick=${() => setEditing({ ...a })}>Editar</button>
                  <button data-testid=${'toggle-agent-' + a.id} className=${'btn ' + (a.activo ? 'btn-ghost danger' : 'btn-ghost')} onClick=${() => onToggleActive(a)}>${a.activo ? 'Desactivar' : 'Reactivar'}</button>
                </div>
              </div>
            </div>`)}
          </div>
        `
      )}

      ${editing ? html`<${AgentModal}
        initial=${editing}
        planInfo=${planInfo}
        onClose=${() => setEditing(null)}
        onSaved=${async () => { await reload(); setEditing(null); }}
      />` : null}
    <//>`;
  }

  // Modal crear/editar agente
  function AgentModal({ initial, planInfo, onClose, onSaved }) {
    const isEdit = !!initial.id;
    const [nombre, setNombre] = useState(initial.nombre || '');
    const [email, setEmail] = useState(initial.email || '');
    const [telefono, setTelefono] = useState(initial.telefono || '');
    const [whatsapp, setWhatsapp] = useState(initial.whatsapp || '');
    const [fotoUrl, setFotoUrl] = useState(initial.foto_url || '');
    const [rol, setRol] = useState(initial.rol || 'agente');
    const [activo, setActivo] = useState(initial.activo !== false);
    const [ghlUserId, setGhlUserId] = useState(
      initial.ghl_user_id && !initial.ghl_user_id.startsWith('pending:') ? initial.ghl_user_id : ''
    );
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);

    const onUpload = async (file) => {
      if (!file) return;
      setUploading(true);
      try {
        const sign = await api('/upload/sign', { method: 'POST', body: { kind: 'brand' } });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('api_key', sign.apiKey);
        fd.append('timestamp', sign.timestamp);
        fd.append('folder', sign.folder);
        fd.append('eager', sign.eager);
        fd.append('signature', sign.signature);
        const r = await fetch(sign.uploadUrl, { method: 'POST', body: fd });
        if (!r.ok) throw new Error('upload_failed');
        const j = await r.json();
        const url = j.eager?.[0]?.secure_url || j.secure_url;
        setFotoUrl(url);
      } catch (e) {
        toast('Error subiendo foto: ' + (e.message || e), 'error');
      } finally { setUploading(false); }
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      if (!nombre.trim()) { toast('Falta el nombre', 'error'); return; }
      setSaving(true);
      try {
        const payload = {
          nombre: nombre.trim(),
          email: email.trim() || null,
          telefono: telefono.trim() || null,
          whatsapp: whatsapp.trim() || null,
          foto_url: fotoUrl || null,
          rol,
          activo,
        };
        if (ghlUserId.trim()) payload.ghl_user_id = ghlUserId.trim();
        if (isEdit) {
          await api('/agent/' + initial.id, { method: 'PUT', body: payload });
          toast('Agente actualizado ✓', 'success');
        } else {
          await api('/agent', { method: 'POST', body: payload });
          toast('Agente agregado ✓', 'success');
        }
        await onSaved();
      } catch (err) {
        const msg = err.detail?.message || err.message;
        toast(msg, 'error');
      } finally { setSaving(false); }
    };

    return html`<div className="modal-backdrop" onClick=${onClose}>
      <div className="modal" onClick=${(e) => e.stopPropagation()} data-testid="agent-modal">
        <div className="modal-header">
          <h2>${isEdit ? 'Editar agente' : 'Agregar agente'}</h2>
          <button className="modal-close" onClick=${onClose}>×</button>
        </div>
        <form onSubmit=${onSubmit} className="modal-body">
          <div className="agent-form-grid">
            <div className="form-field full">
              <label className="form-label">Foto</label>
              <div className="coll-photo-uploader">
                ${fotoUrl ? html`<div className="agent-photo-preview">
                  <img src=${fotoUrl} alt="" />
                  <button type="button" className="rm" onClick=${() => setFotoUrl('')}>×</button>
                </div>` : null}
                <label className="photo-uploader" style=${{ width: fotoUrl ? '120px' : '100%' }}>
                  <input type="file" accept="image/*" onChange=${(e) => onUpload(e.target.files[0])} />
                  <div>${uploading ? 'Subiendo…' : (fotoUrl ? '↺ Reemplazar' : '＋ Subir foto')}</div>
                </label>
              </div>
            </div>
            <div className="form-field full">
              <label className="form-label">Nombre <span className="req">*</span></label>
              <input data-testid="agent-name" className="form-input" value=${nombre} onInput=${(e) => setNombre(e.target.value)} autoFocus />
            </div>
            <div className="form-field">
              <label className="form-label">Email</label>
              <input data-testid="agent-email" className="form-input" type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Teléfono</label>
              <input data-testid="agent-phone" className="form-input" value=${telefono} onInput=${(e) => setTelefono(e.target.value)} placeholder="+52 998 ..." />
            </div>
            <div className="form-field">
              <label className="form-label">WhatsApp</label>
              <input data-testid="agent-whatsapp" className="form-input" value=${whatsapp} onInput=${(e) => setWhatsapp(e.target.value)} placeholder="+52 998 ..." />
            </div>
            <div className="form-field">
              <label className="form-label">Rol</label>
              <select data-testid="agent-role" className="form-input" value=${rol} onChange=${(e) => setRol(e.target.value)}>
                <option value="agente">Agente</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="form-field full">
              <label className="form-label">GHL User ID (opcional)</label>
              <input
                data-testid="agent-ghl-id"
                className="form-input"
                value=${ghlUserId}
                onInput=${(e) => setGhlUserId(e.target.value)}
                placeholder="pyr7tK7t6wBZMpsL5pFJ"
              />
              <span className="form-help">Déjalo en blanco y el sistema lo vinculará automáticamente cuando el agente entre por primera vez desde GHL.</span>
            </div>
            ${isEdit ? html`<div className="form-field full">
              <label className="form-toggle">
                <input type="checkbox" checked=${activo} onChange=${(e) => setActivo(e.target.checked)} />
                <span>Agente activo (aparece en dropdown de propiedades y página pública)</span>
              </label>
            </div>` : null}
          </div>

          <div className="action-bar" style=${{ position: 'static', margin: '12px -24px -20px' }}>
            <button type="button" className="btn btn-ghost" onClick=${onClose} disabled=${saving}>Cancelar</button>
            <button type="submit" data-testid="agent-save-btn" className="btn btn-primary" disabled=${saving || uploading}>${saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Agregar agente')}</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  // -------------------------------------------------------------------
  // SettingsPage — Paso 10 (Dominio) + más tabs en pasos siguientes
  // -------------------------------------------------------------------
  function SettingsPage({ ctx }) {
    const [tab, setTab] = useState('domain');
    const tabs = [
      { id: 'domain', label: 'Dominio' },
      { id: 'brand', label: 'Marca', disabled: true },
      { id: 'widget', label: 'Widget de contacto', disabled: true },
    ];
    return html`<${Fragment}>
      <div className="page-header"><div>
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Ajusta tu dominio, marca y widget de contacto.</p>
      </div></div>
      <div className="settings-tabs">
        ${tabs.map((t) => html`<button
          key=${t.id}
          className=${'settings-tab' + (tab === t.id ? ' active' : '')}
          disabled=${t.disabled}
          onClick=${() => !t.disabled && setTab(t.id)}
        >${t.label}${t.disabled ? ' (próximamente)' : ''}</button>`)}
      </div>
      ${tab === 'domain' ? html`<${DomainTab} ctx=${ctx} />` : null}
    <//>`;
  }

  function DomainTab({ ctx }) {
    const [state, setState] = useState({ loading: true, dominio: null, cnameTarget: '', input: '' });
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState(null);
    const isAdmin = ctx.tenant && ctx.tenant.rol === 'admin'; // placeholder

    const reload = useCallback(async () => {
      const d = await api('/domain');
      setState((s) => ({ ...s, loading: false, dominio: d.dominio, cnameTarget: d.cname_target, input: d.dominio?.subdominio || s.input }));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const onSave = async (e) => {
      e.preventDefault();
      const host = (state.input || '').trim().toLowerCase();
      if (!host) { toast('Ingresa un subdominio', 'error'); return; }
      setSaving(true);
      try {
        const d = await api('/domain', { method: 'POST', body: { subdominio: host } });
        setState((s) => ({ ...s, dominio: d.dominio }));
        setVerifyResult(null);
        toast('Subdominio guardado. Ahora agrega el CNAME en tu DNS.', 'success');
      } catch (err) {
        toast(err.detail?.message || err.message, 'error');
      } finally { setSaving(false); }
    };

    const onVerify = async () => {
      setVerifying(true);
      setVerifyResult(null);
      try {
        const d = await api('/domain/verify', { method: 'POST' });
        setVerifyResult(d);
        setState((s) => ({ ...s, dominio: d.dominio }));
        toast(d.ok ? '✓ CNAME verificado' : 'CNAME aún no resuelve correctamente', d.ok ? 'success' : 'error');
      } catch (err) {
        toast(err.detail?.message || err.message, 'error');
      } finally { setVerifying(false); }
    };

    const copyCname = async () => {
      try {
        await navigator.clipboard.writeText(state.cnameTarget);
        toast('Copiado ✓', 'success');
      } catch { toast('No pude copiar', 'error'); }
    };

    if (state.loading) return html`<div className="card">Cargando…</div>`;

    const dom = state.dominio;
    const status = dom?.cname_verificado ? 'verified' : (dom ? 'pending' : 'none');
    const portalUrl = dom?.subdominio && dom.cname_verificado ? `https://${dom.subdominio}/` : null;

    return html`<div className="card domain-card">
      <h2 className="card-title">Tu portal público</h2>
      <p className="card-help">Configura el subdominio donde se publicará tu portal de propiedades. Tus visitantes lo verán al compartir un listing.</p>

      <form onSubmit=${onSave} className="domain-form">
        <label className="form-label" htmlFor="dom-input">Hostname completo</label>
        <div className="domain-input-row">
          <input
            data-testid="domain-input"
            id="dom-input"
            className="form-input"
            placeholder="propiedades.tudominio.com"
            value=${state.input}
            onInput=${(e) => setState((s) => ({ ...s, input: e.target.value }))}
            disabled=${saving}
          />
          <button data-testid="domain-save-btn" type="submit" className="btn btn-primary" disabled=${saving}>${saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
        <span className="form-help">Ejemplo: <code>propiedades.thebrokers.mx</code></span>
      </form>

      ${dom ? html`<${Fragment}>
        <div className=${'status-pill status-' + status} data-testid="domain-status">
          ${status === 'verified' ? html`<${Fragment}><span className="dot ok"></span> Activo · CNAME verificado<//>` :
            html`<${Fragment}><span className="dot pending"></span> Pendiente · esperando configuración DNS<//>`}
        </div>

        ${portalUrl ? html`<div className="portal-link">
          Tu portal en vivo:
          <a href=${portalUrl} target="_blank" rel="noopener">${portalUrl}</a>
        </div>` : null}

        <div className="cname-instructions">
          <h3>Instrucciones de DNS</h3>
          <p>Agrega este registro <strong>CNAME</strong> en tu proveedor DNS (Cloudflare, GoDaddy, Route53, etc.):</p>
          <table className="dns-table">
            <thead><tr><th>Tipo</th><th>Nombre</th><th>Valor</th></tr></thead>
            <tbody><tr>
              <td><code>CNAME</code></td>
              <td><code>${dom.subdominio.split('.')[0]}</code> <span className="td-help">(o el subdominio que elegiste)</span></td>
              <td>
                <div className="value-row">
                  <code data-testid="cname-target">${state.cnameTarget}</code>
                  <button type="button" className="btn-link" onClick=${copyCname}>Copiar</button>
                </div>
              </td>
            </tr></tbody>
          </table>
          <p className="dns-tip">La propagación DNS puede tardar entre <strong>1 minuto y 24 horas</strong>. Verificamos automáticamente cada minuto.</p>

          <div className="verify-row">
            <button data-testid="verify-now-btn" type="button" className="btn btn-ghost" onClick=${onVerify} disabled=${verifying}>${verifying ? 'Verificando DNS…' : 'Verificar ahora'}</button>
            ${verifyResult ? html`<span className=${'verify-result ' + (verifyResult.ok ? 'ok' : 'err')}>
              ${verifyResult.ok
                ? html`✓ Resuelve a ${verifyResult.resolved_to?.join(', ')}`
                : html`✗ ${verifyResult.error || 'No verificado'}`}
            </span>` : null}
          </div>

          ${status === 'verified' ? html`<div className="next-step">
            <strong>Último paso (manual):</strong> el creador de la plataforma debe agregar <code>${dom.subdominio}</code> como dominio custom en el dashboard de Railway para activar el SSL. Avísale por email a <a href="mailto:soporte@mktscaled.com">soporte@mktscaled.com</a>.
          </div>` : null}
        </div>
      <//>` : null}
    </div>`;
  }

  // -------------------------------------------------------------------
  // App root
  // -------------------------------------------------------------------
  function App() {
    const boot = useBootstrap();
    const [page, setPage] = useState('new');
    const [mobile, setMobile] = useState(false);
    // Estado liftado: colecciones mutan desde la pantalla Colecciones, pero
    // las usa también el form de propiedad (chips para asignar).
    const [colecciones, setColecciones] = useState([]);
    useEffect(() => {
      if (boot.colecciones) setColecciones(boot.colecciones);
    }, [boot.colecciones]);

    const reloadCollections = useCallback(async () => {
      const d = await api('/collection');
      setColecciones(d.colecciones || []);
      return d;
    }, []);

    if (boot.loading) return html`<div className="boot"><div className="boot-spinner"></div><div className="boot-text">Cargando panel…</div></div>`;
    if (boot.error) return html`<div className="boot"><div className="boot-text" style=${{ color: '#dc2626' }}>${boot.error}</div></div>`;

    const ctx = {
      agentes: boot.agentes,
      colecciones,
      reloadCollections,
      setColecciones,
      googleMapsApiKey: boot.config.googleMapsApiKey,
      tenant: boot.session.tenant,
      portal: boot.portal,
    };

    let body;
    switch (page) {
      case 'dashboard': body = html`<${Dashboard} ctx=${ctx} />`; break;
      case 'new': body = html`<${NewPropertyPage} ctx=${ctx} />`; break;
      case 'listings': body = html`<${Placeholder} title="Mis listings" subtitle="La tabla con búsqueda y filtros está lista para construirse sobre /api/property." />`; break;
      case 'collections': body = html`<${CollectionsPage} ctx=${ctx} />`; break;
      case 'team': body = html`<${TeamPage} ctx=${ctx} />`; break;
      case 'settings': body = html`<${SettingsPage} ctx=${ctx} />`; break;
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
