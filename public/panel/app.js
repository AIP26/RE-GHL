/* =====================================================================
   mktscaled-listings — Panel SPA
   React 18 UMD + htm (sin build step).
   ===================================================================== */
(function () {
  'use strict';
  const { createElement: h, useState, useEffect, useCallback, useMemo, useRef, Fragment } = React;
  const { createPortal } = ReactDOM;
  const html = htm.bind(h);

  // -------------------------------------------------------------------
  // API helper
  // -------------------------------------------------------------------
  const API = '/api';
  let _token = null;
  let _reSsoInFlight = null;   // dedupe: si dos requests entran en 401 a la vez, sólo un fetch SSO
  function setToken(t) { _token = t; }

  /** Re-emite el session token pidiendo /auth/sso con los params que aún están
   *  en la URL del iframe (GHL nunca los quita). Devuelve true si logró refrescar,
   *  false si no hay params o el SSO respondió con error. */
  async function reAuthFromUrl() {
    if (_reSsoInFlight) return _reSsoInFlight;
    _reSsoInFlight = (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const locationId = params.get('locationId');
        const userId = params.get('userId');
        if (!locationId || !userId) return false;
        const r = await fetch(`${API}/auth/sso?locationId=${encodeURIComponent(locationId)}&userId=${encodeURIComponent(userId)}`);
        if (!r.ok) return false;
        const j = await r.json();
        if (!j.token) return false;
        setToken(j.token);
        return true;
      } catch { return false; }
      finally { _reSsoInFlight = null; }
    })();
    return _reSsoInFlight;
  }

  async function api(path, opts = {}) {
    const doFetch = async () => {
      const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
      if (_token) headers['Authorization'] = 'Bearer ' + _token;
      let body = opts.body;
      if (body && typeof body !== 'string' && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(API + path, { ...opts, headers, body });
    };

    let res = await doFetch();

    // Session expiró (JWT 8h) → intenta re-SSO transparente UNA vez y reintenta.
    // No re-intentamos el propio /auth/sso para evitar loops.
    if (res.status === 401 && !opts._retried && path !== '/auth/sso') {
      const ok = await reAuthFromUrl();
      if (ok) {
        opts._retried = true;
        res = await doFetch();
      }
    }

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
  const AMENIDADES = ['Alberca','Gym','Roof garden','Vigilancia 24h','Elevador','Área BBQ','Jardín','Salón de eventos','Beach Club','Acceso a playa','Cancha','Spa','Golf','Kids area','Restaurante-Bar','Intercomunicador','Portón eléctrico','Pádel','Tenis','Acceso para discapacitados','Internet','Recepción'];
  const NORMAS = ['Pet friendly','Permite rentas vacacionales','Solo familias','No niños'];
  const MONEDAS = ['USD','MXN','CAD'];

  const SECTIONS = [
    { title: 'Información general', fields: [
      { key: 'titulo', label: 'Título', type: 'text', required: true, maxLength: 100, span: 2 },
      { key: 'descripcion', label: 'Descripción', type: 'textarea', required: true, full: true },
      { key: 'tipo_operacion', label: 'Tipo de operación', type: 'select', required: true, options: ['Venta','Renta'] },
      { key: 'tipo_inmueble', label: 'Tipo de inmueble', type: 'select', required: true, options: ['Casa','Departamento','Local','Terreno','Oficina','Bodega','Villa','Penthouse'] },
      { key: 'estado', label: 'Estado', type: 'select', required: true, options: ['Disponible','Vendida','Rentada','Pausada'] },
      { key: 'etiqueta', label: 'Etiqueta', type: 'select', options: ['','Destacada','Nueva','Oportunidad','Preventa','Remate'] },
      { key: 'preventa', label: 'Preventa', type: 'toggle' },
      { key: 'fecha_entrega', label: 'Fecha estimada de entrega', type: 'date', showIf: (s) => s.preventa },
      { key: 'agente_responsable', label: 'Agente responsable', type: 'agent', required: true },
    ]},
    { title: 'Precio', fields: [
      { key: 'precio_principal', label: 'Precio principal', type: 'number', required: true, span: 1 },
      { key: 'moneda_principal', label: 'Moneda principal', type: 'select', required: true, options: MONEDAS, span: 1 },
      { key: 'precio_secundario', label: 'Precio secundario (opcional)', type: 'number' },
      { key: 'moneda_secundaria', label: 'Moneda secundaria', type: 'select', options: ['', ...MONEDAS] },
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
      { key: 'amenidades', label: 'Selecciona las amenidades disponibles', type: 'amenities', options: AMENIDADES, full: true },
      { key: 'vista_principal', label: 'Vista principal', type: 'select', options: ['','Calle','Mar','Jardín','Montaña','Ciudad','Laguna','Campo de golf'] },
      { key: 'vista_secundaria', label: 'Vista secundaria', type: 'text' },
      { key: 'aire_acondicionado', label: 'Aire acondicionado', type: 'toggle' },
    ]},
    { title: 'Situación y conservación', fields: [
      { key: 'situacion_legal', label: 'Situación legal', type: 'select', required: true, options: ['Libre de gravamen','Gravamen hipotecario','Gravamen Infonavit','Otro (consultar)'] },
      { key: 'estado_conservacion', label: 'Estado de conservación', type: 'select', required: true, options: ['Nuevo','Excelente','Bueno','Regular','Necesita remodelación'] },
    ]},
    { title: 'Normas de la propiedad', fields: [
      { key: 'normas', label: 'Selecciona las normas aplicables', type: 'amenities', options: NORMAS, full: true },
    ]},
    { title: 'Fotos y media', fields: [
      { key: 'fotos_urls', label: 'Fotos (arrastra para reordenar — la 1ª es la portada)', type: 'photos', required: true, full: true },
      { key: 'video_propio_url', label: 'Video propio (sube un mp4/mov, hasta 200 MB)', type: 'video_upload', full: true },
      { key: 'video_url', label: 'O pega una URL de YouTube / Vimeo', type: 'text', full: true },
      { key: 'tour_virtual_url', label: 'Tour virtual URL (Matterport)', type: 'text' },
      { key: 'planos_url', label: 'Planos URL', type: 'text' },
    ]},
    { title: 'CTA y colecciones', fields: [
      { key: 'cta_tipo', label: 'CTA de la propiedad', type: 'select', options: ['global','whatsapp','formulario','redirect'], defaultValue: 'global' },
      { key: 'cta_valor', label: 'Valor del CTA (número, snippet o URL)', type: 'cta_value', showIf: (s) => s.cta_tipo && s.cta_tipo !== 'global', span: 2 },
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
    // BACKWARD COMPAT: el PDF, portal público y búsqueda aún leen precio_usd/
    // precio_mxn. Mantenemos esos campos sincronizados según moneda elegida.
    // Cualquier valor previo se sobreescribe (no acumulamos legacy errado).
    out.precio_usd = '';
    out.precio_mxn = '';
    const mapPrice = (amount, currency) => {
      if (amount == null || amount === '' || !currency) return;
      const n = Number(amount);
      if (!Number.isFinite(n)) return;
      if (currency === 'USD') out.precio_usd = n;
      else if (currency === 'MXN') out.precio_mxn = n;
      // CAD no tiene legacy → no lo escribimos en USD/MXN
    };
    mapPrice(state.precio_principal, state.moneda_principal);
    mapPrice(state.precio_secundario, state.moneda_secundaria);
    // Limpia los keys vacíos para no enviarlos
    if (out.precio_usd === '') delete out.precio_usd;
    if (out.precio_mxn === '') delete out.precio_mxn;
    return out;
  }

  // Convierte el record de GHL (+ _collections) -> state del form para edición.
  function deserializeFromRecord(record, collections) {
    const props = record?.properties || {};
    const state = { _collections: collections || [] };
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        if (f.key === '_collections') continue;
        const v = props[f.key];
        if (v == null || v === '') continue;
        if (f.type === 'toggle') {
          state[f.key] = (v === 'Sí' || v === true || v === 'true' || v === 1 || v === '1');
        } else if (f.type === 'amenities') {
          state[f.key] = typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
        } else if (f.type === 'photos') {
          state[f.key] = typeof v === 'string' ? v.split('|').filter(Boolean) : (Array.isArray(v) ? v : []);
        } else if (f.type === 'number') {
          state[f.key] = Number(v);
        } else {
          state[f.key] = v;
        }
      }
    }
    // BACKWARD COMPAT: si la propiedad no tiene los nuevos precios pero sí
    // los legacy (precio_usd/precio_mxn), los mapeamos para que el form
    // muestre algo coherente al editar.
    if (!state.precio_principal && props.precio_usd) {
      state.precio_principal = Number(props.precio_usd);
      state.moneda_principal = 'USD';
      if (props.precio_mxn) {
        state.precio_secundario = Number(props.precio_mxn);
        state.moneda_secundaria = 'MXN';
      }
    } else if (!state.precio_principal && props.precio_mxn) {
      state.precio_principal = Number(props.precio_mxn);
      state.moneda_principal = 'MXN';
    }
    return state;
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
      case 'cta_value':
        // Field polimórfico: cambia su UI según state.cta_tipo. Cuando es
        // 'formulario' muestra textarea + validación de dominio GHL + preview.
        return html`<div className=${'form-field ' + span}>
          ${label}
          <${CtaValueInput} state=${state} set=${set} field=${field} />
        </div>`;
      case 'select': {
        // Para campos requeridos sin opción vacía explícita, anteponer un
        // placeholder "— Selecciona —" para forzar elección consciente del usuario.
        // (Evita el bug visual donde la primera opción parecía "seleccionada"
        // pero el state seguía sin valor real.)
        const hasEmptyOpt = field.options.includes('');
        const showPlaceholder = field.required && !hasEmptyOpt;
        control = html`<select id=${field.key} className="form-select" value=${value || ''} onChange=${(e) => set(field.key, e.target.value)} required=${!!field.required}>
          ${showPlaceholder ? html`<option value="" disabled>— Selecciona —</option>` : null}
          ${field.options.map((opt) => html`<option key=${opt} value=${opt}>${opt === '' ? '— ninguno —' : opt}</option>`)}
        </select>`;
        break;
      }
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
      case 'amenities': {
        // Lista de opciones desde la definición del field. Fallback a la
        // constante global por retro-compatibilidad si algún caller la omitiera.
        const opts = field.options || AMENIDADES;
        return html`<div className=${'form-field ' + span}>
          ${label}
          <div className="amen-grid">
            ${opts.map((opt) => {
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
      }
      case 'photos':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <${PhotosInput} value=${value || []} onChange=${(arr) => set(field.key, arr)} />
        </div>`;
      case 'video_upload':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <${VideoUpload} value=${value || ''} onChange=${(url) => set(field.key, url)} />
        </div>`;
      case 'collections':
        return html`<div className=${'form-field ' + span}>
          ${label}
          <${CollectionsField} state=${state} set=${set} ctx=${ctx} />
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
    const [dragging, setDragging] = useState(null); // índice que está siendo arrastrado (visual)
    const [dragOver, setDragOver] = useState(null); // índice sobre el que está el cursor (visual)

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

    // Drag handlers:
    // - Firefox exige `setData()` o el drag NO inicia, por eso pasamos un texto vacío.
    // - El <img> interno tiene draggable=false para que el navegador no inicie un
    //   drag de imagen (su comportamiento por defecto) que rompe el del wrapper.
    // - `dragging` y `dragOver` son sólo para feedback visual; el índice real
    //   se guarda en `dragIdx.current` (ref) para evitar staleness.
    const onDragStart = (i) => (e) => {
      dragIdx.current = i;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) { /* algunos browsers no aceptan */ }
      setDragging(i);
    };
    const onDragEnd = () => { dragIdx.current = null; setDragging(null); setDragOver(null); };
    const onDragOver = (i) => (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOver !== i) setDragOver(i);
    };
    const onDragLeave = (i) => () => { if (dragOver === i) setDragOver(null); };
    const onDrop = (i) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = dragIdx.current;
      setDragging(null); setDragOver(null);
      if (from == null || from === i || !Array.isArray(value)) { dragIdx.current = null; return; }
      const arr = [...value];
      if (from < 0 || from >= arr.length) { dragIdx.current = null; return; }
      const [moved] = arr.splice(from, 1);
      const insertAt = Math.max(0, Math.min(i, arr.length));
      arr.splice(insertAt, 0, moved);
      dragIdx.current = null;
      onChange(arr);
    };

    return html`
      <div className="photos">
        ${(value || []).map((url, i) => html`
          <div
            key=${url + '#' + i}
            className=${'photo-thumb' + (dragging === i ? ' dragging' : '') + (dragOver === i && dragging !== i ? ' drop-target' : '')}
            draggable=${true}
            onDragStart=${onDragStart(i)}
            onDragEnd=${onDragEnd}
            onDragOver=${onDragOver(i)}
            onDragLeave=${onDragLeave(i)}
            onDrop=${onDrop(i)}
            data-testid=${'photo-thumb-' + i}
          >
            <img src=${url} alt="" draggable=${false} />
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

  // Uploader de video propio. Sube directo a Cloudinary con resource_type=video.
  // Límite 200 MB (validación client-side). Soporta mp4 / mov / webm.
  function VideoUpload({ value, onChange }) {
    const [progress, setProgress] = useState(0);      // 0..100 durante upload
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState('');

    const MAX_BYTES = 200 * 1024 * 1024;

    const uploadFile = async (file) => {
      if (!file) return;
      setErr('');
      if (file.size > MAX_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(0);
        setErr(`El archivo pesa ${mb} MB. Máximo 200 MB.`);
        return;
      }
      if (!/^video\/(mp4|quicktime|x-msvideo|webm)$/i.test(file.type) &&
          !/\.(mp4|mov|webm|avi)$/i.test(file.name)) {
        setErr('Formato no soportado. Usa mp4, mov o webm.');
        return;
      }
      setUploading(true);
      setProgress(0);
      try {
        const sign = await api('/upload/sign-video', { method: 'POST' });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('api_key', sign.apiKey);
        fd.append('timestamp', sign.timestamp);
        fd.append('folder', sign.folder);
        fd.append('eager', sign.eager);
        fd.append('eager_async', 'true');
        // `resource_type` va en el PATH de la URL (/video/upload), NO en el
        // body — si se envía como form field, Cloudinary lo mete en la firma
        // esperada y falla con "Invalid Signature".
        fd.append('signature', sign.signature);

        // Usamos XHR (no fetch) porque expone progress events para el uploader.
        const xhr = new XMLHttpRequest();
        const url = await new Promise((resolve, reject) => {
          xhr.open('POST', sign.uploadUrl);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const j = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(j.secure_url || j.url);
              else reject(new Error(j?.error?.message || 'Falló el upload'));
            } catch (e) { reject(new Error('Respuesta inválida de Cloudinary')); }
          };
          xhr.onerror = () => reject(new Error('Error de red al subir'));
          xhr.send(fd);
        });
        onChange(url);
      } catch (e) {
        setErr(e.message || 'Error subiendo video');
      } finally {
        setUploading(false);
        setProgress(0);
      }
    };

    const clear = () => { onChange(''); setErr(''); };

    if (value) {
      return html`
        <div className="video-preview" data-testid="video-preview">
          <video src=${value} controls preload="metadata" style=${{ width: '100%', maxHeight: '200px', background: '#000', borderRadius: '8px', display: 'block' }} />
          <div style=${{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
            <span style=${{ fontSize: '12px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>${value}</span>
            <button type="button" className="btn btn-ghost" onClick=${clear} data-testid="video-remove-btn" style=${{ fontSize: '12px', padding: '6px 12px' }}>Quitar</button>
          </div>
        </div>`;
    }
    // Estado vacío: dropzone compacto ~80px, similar al "+ Agregar" de fotos.
    return html`
      <label className="photo-uploader video-uploader-empty" style=${{ height: '80px', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: '10px', cursor: uploading ? 'wait' : 'pointer' }} data-testid="video-upload-label">
        <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange=${(e) => uploadFile(e.target.files?.[0])} disabled=${uploading} />
        ${uploading
          ? html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style=${{ fontSize: '13px', fontWeight: 600 }}>Subiendo… ${progress}%</div>
              <div style=${{ width: '140px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style=${{ width: progress + '%', height: '100%', background: 'var(--color-primary, #0ea5e9)', transition: 'width .2s' }}></div>
              </div>
            </div>`
          : html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style=${{ fontSize: '20px', lineHeight: 1 }}>＋</span>
              <div style=${{ textAlign: 'left' }}>
                <div style=${{ fontSize: '13px', fontWeight: 600 }}>Subir video</div>
                <div style=${{ fontSize: '11px', color: 'var(--color-text-muted)' }}>mp4 / mov / webm · hasta 200 MB</div>
              </div>
            </div>`}
      </label>
      ${err ? html`<div style=${{ color: '#dc2626', fontSize: '13px', marginTop: '8px' }} data-testid="video-upload-error">${err}</div>` : null}
    `;
  }

  // CtaValueInput — polimórfico según state.cta_tipo.
  //   - formulario: <textarea> con validación live del <iframe src=...> contra
  //     whitelist de dominios GHL + preview live.
  //   - whatsapp:  input tel
  //   - redirect:  input url
  function CtaValueInput({ state, set, field }) {
    const value = state.cta_valor || '';
    const tipo = state.cta_tipo;
    const validation = useMemo(() => validateGhlEmbed(value), [value]);

    if (tipo === 'formulario') {
      return html`<${Fragment}>
        <textarea
          id=${field.key}
          className="form-textarea"
          data-testid="cta-form-textarea"
          rows="4"
          placeholder='Pega aquí el código embed de tu formulario GHL (empieza con <iframe...)'
          value=${value}
          onInput=${(e) => set(field.key, e.target.value)}
        />
        ${value && !validation.ok ? html`<div className="form-error" data-testid="cta-form-error">
          Solo se permiten formularios de GoHighLevel.
          ${validation.error === 'no_iframe_src' ? ' Falta un <iframe src="…">.' : ''}
          ${validation.error === 'host_not_allowed' ? ` Dominio "${validation.host}" no está autorizado.` : ''}
        </div>` : null}
        ${validation.ok ? html`<div className="cta-form-preview" data-testid="cta-form-preview">
          <div className="cta-form-preview-title">Vista previa</div>
          <iframe
            src=${validation.src}
            title="Preview formulario GHL"
            loading="lazy"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
            style=${{ width: '100%', height: '400px', border: 0, display: 'block' }}
          ></iframe>
        </div>` : null}
        <span className="form-help">Dominios válidos: *.gohighlevel.com · *.leadconnectorhq.com · *.msgsndr.com</span>
      <//>`;
    }

    // whatsapp / redirect / otros → input plano.
    const inputType = tipo === 'whatsapp' ? 'tel' : (tipo === 'redirect' ? 'url' : 'text');
    const placeholder = tipo === 'whatsapp' ? '+52 998 432 4991'
      : tipo === 'redirect' ? 'https://…'
      : '';
    return html`<input
      id=${field.key}
      type=${inputType}
      className="form-input"
      data-testid="cta-value-input"
      value=${value}
      placeholder=${placeholder}
      onInput=${(e) => set(field.key, e.target.value)}
    />`;
  }

  // Whitelist local (debe coincidir con server-side y portal público).
  function validateGhlEmbed(html) {
    if (!html || typeof html !== 'string') return { ok: false, error: 'empty' };
    const m = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
    if (!m) return { ok: false, error: 'no_iframe_src' };
    const src = m[1];
    let url; try { url = new URL(src); } catch { return { ok: false, error: 'invalid_url' }; }
    const host = url.hostname.toLowerCase();
    const allowed = ['gohighlevel.com', 'leadconnectorhq.com', 'msgsndr.com'].some((d) => host === d || host.endsWith('.' + d));
    if (!allowed) return { ok: false, error: 'host_not_allowed', host };
    return { ok: true, src, host };
  }

  // CollectionsField — chips selección + opción "+ Crear nueva" inline.
  // Crear: muestra input + Crear/Cancelar; POSTea, recarga la lista global,
  // y auto-asigna la colección recién creada a la propiedad actual.
  function CollectionsField({ state, set, ctx }) {
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef(null);

    const startCreate = () => {
      setCreating(true);
      setNewName('');
      // Focus después de que React monte el input
      setTimeout(() => inputRef.current?.focus(), 30);
    };
    const cancelCreate = () => { setCreating(false); setNewName(''); };

    const submitCreate = async () => {
      const name = newName.trim();
      if (!name) { toast('Escribe un nombre para la colección', 'error'); return; }
      setSaving(true);
      try {
        const r = await api('/collection', { method: 'POST', body: { nombre: name } });
        const created = r.coleccion;
        if (created?.id) {
          await ctx.reloadCollections();
          // Auto-seleccionar la recién creada
          const arr = [...(state._collections || [])];
          if (!arr.includes(created.id)) arr.push(created.id);
          set('_collections', arr);
          toast('Colección "' + created.nombre + '" creada y asignada ✓', 'success');
        }
        cancelCreate();
      } catch (err) {
        toast('Error al crear: ' + (err.detail?.message || err.message), 'error');
      } finally { setSaving(false); }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
    };

    return html`<div className="coll-list" data-testid="collections-field">
      ${ctx.colecciones.length === 0 && !creating
        ? html`<span className="form-help">Aún no tienes colecciones — crea la primera abajo.</span>`
        : null}
      ${ctx.colecciones.map((c) => {
        const sel = (state._collections || []).includes(c.id);
        return html`<span
          key=${c.id}
          data-testid=${'coll-pill-' + c.slug}
          className=${'coll-pill' + (sel ? ' selected' : '')}
          onClick=${() => {
            const arr = [...(state._collections || [])];
            const i = arr.indexOf(c.id);
            if (i >= 0) arr.splice(i, 1); else arr.push(c.id);
            set('_collections', arr);
          }}
        >${c.nombre}</span>`;
      })}
      ${creating ? html`<span className="coll-pill coll-pill-create" data-testid="collection-create-inline" onClick=${(e) => e.stopPropagation()}>
        <input
          ref=${inputRef}
          data-testid="collection-create-input"
          className="coll-pill-input"
          value=${newName}
          onInput=${(e) => setNewName(e.target.value)}
          onKeyDown=${onKeyDown}
          placeholder="Nombre de la colección…"
          maxLength="60"
          disabled=${saving}
        />
        <button type="button" data-testid="collection-create-save" className="coll-pill-btn primary" onClick=${submitCreate} disabled=${saving || !newName.trim()}>${saving ? '…' : 'Crear'}</button>
        <button type="button" data-testid="collection-create-cancel" className="coll-pill-btn" onClick=${cancelCreate} disabled=${saving}>×</button>
      </span>` : html`<button
        type="button"
        data-testid="collection-create-btn"
        className="coll-pill coll-pill-add"
        onClick=${startCreate}
      >＋ Crear nueva colección</button>`}
    </div>`;
  }

  // -------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------
  function NewPropertyPage({ ctx, editingId, onAfterSave }) {
    const initial = useMemo(() => {
      const s = { _collections: [] };
      for (const sec of SECTIONS) for (const f of sec.fields) {
        if (f.defaultValue != null) s[f.key] = f.defaultValue;
      }
      return s;
    }, []);
    const [state, setState] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [loadingEdit, setLoadingEdit] = useState(!!editingId);
    const isEdit = !!editingId;
    const set = useCallback((k, v) => setState((s) => ({ ...s, [k]: v })), []);

    // Si estamos en modo edición, carga el record y prellena el form.
    useEffect(() => {
      if (!editingId) return;
      let cancelled = false;
      (async () => {
        setLoadingEdit(true);
        try {
          const r = await api('/property/' + editingId);
          if (cancelled) return;
          const filled = deserializeFromRecord(r.record, r._collections);
          // Mantén defaults para keys ausentes
          setState({ ...initial, ...filled });
        } catch (err) {
          toast('No se pudo cargar la propiedad: ' + (err.detail?.error || err.message), 'error');
        } finally {
          if (!cancelled) setLoadingEdit(false);
        }
      })();
      return () => { cancelled = true; };
    }, [editingId, initial]);

    const onSubmit = async (e) => {
      e.preventDefault();
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
        if (isEdit) {
          await api('/property/' + editingId, { method: 'PUT', body: payload });
          toast('Cambios guardados ✓', 'success');
          if (onAfterSave) onAfterSave();
        } else {
          await api('/property', { method: 'POST', body: payload });
          toast('Propiedad creada ✓', 'success');
          setState({ ...initial });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch (err) {
        toast('Error al guardar: ' + (err.detail?.error || err.message), 'error');
      } finally {
        setSaving(false);
      }
    };

    if (loadingEdit) {
      return html`<div className="card" data-testid="property-form-loading"><div className="empty-state"><h3>Cargando propiedad…</h3></div></div>`;
    }

    return html`
      <div className="page-header">
        <div>
          <h1 className="page-title" data-testid="property-form-title">${isEdit ? 'Editar propiedad' : 'Nueva propiedad'}</h1>
          <p className="page-subtitle">${isEdit ? 'Modifica los campos y guarda los cambios.' : 'Completa los campos. Se publicará en tu portal y queda lista para compartir.'}</p>
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
          <button type="button" className="btn btn-ghost" disabled=${saving} onClick=${() => setState({ ...initial })} data-testid="property-form-clear">${isEdit ? 'Descartar' : 'Limpiar'}</button>
          <button type="submit" className="btn btn-primary" disabled=${saving} data-testid="property-form-submit">${saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Publicar propiedad')}</button>
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
  // Helper: filtra URLs que apuntan a fotos de propiedad (`/tenants/X/properties/`).
  // Una colección sólo debería mostrar fotos subidas explícitamente para ella.
  function safeCollectionPhoto(url) {
    if (!url || typeof url !== 'string') return '';
    if (/\/tenants\/[^/]+\/properties\//i.test(url)) return '';
    return url;
  }

  function CollectionsPage({ ctx }) {
    const [editing, setEditing] = useState(null); // null | { id?, nombre, foto_url }
    const [openMenu, setOpenMenu] = useState(null); // { id, c, anchor }

    // Cierra el menú al click fuera, scroll o resize. Excepción: scroll dentro
    // del propio menu floating no debe cerrarlo.
    useEffect(() => {
      const close = (ev) => {
        if (ev && ev.target && ev.target.closest && ev.target.closest('.coll-card-menu-pop')) return;
        setOpenMenu(null);
      };
      document.addEventListener('click', close);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
      return () => {
        document.removeEventListener('click', close);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
      };
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
            const cover = safeCollectionPhoto(c.foto_url);
            return html`<div key=${c.id} className="coll-card" data-testid=${'collection-card-' + c.slug}>
              <div className="coll-card-cover">
                ${cover
                  ? html`<img src=${cover} alt=${c.nombre} />`
                  : html`<div className="coll-card-cover-placeholder">${c.nombre.charAt(0).toUpperCase()}</div>`}
                <button
                  data-testid=${'collection-menu-' + c.slug}
                  className="coll-card-menu"
                  onClick=${(e) => {
                    e.stopPropagation();
                    if (openMenu?.id === c.id) { setOpenMenu(null); return; }
                    const r = e.currentTarget.getBoundingClientRect();
                    setOpenMenu({ id: c.id, c, anchor: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height } });
                  }}
                  title="Más acciones"
                >···</button>
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

      ${openMenu ? createPortal(
        h(CollectionMenuPortal, {
          anchor: openMenu.anchor,
          c: openMenu.c,
          url: buildUrl(openMenu.c.slug),
          onClose: () => setOpenMenu(null),
          onEdit: () => { setEditing({ ...openMenu.c }); setOpenMenu(null); },
          onCopyUrl: () => { copyUrl(buildUrl(openMenu.c.slug)); setOpenMenu(null); },
          onDelete: () => { const c = openMenu.c; setOpenMenu(null); onDelete(c); },
        }),
        document.body
      ) : null}
    <//>`;
  }

  // Floating dropdown para colecciones — mismo patrón que RowMenuPortal (Mis listings)
  function CollectionMenuPortal({ anchor, c, url, onClose, onEdit, onCopyUrl, onDelete }) {
    const ref = useRef(null);
    const [pos, setPos] = useState(null);

    useEffect(() => {
      if (!ref.current) return;
      const menuH = ref.current.offsetHeight;
      const menuW = ref.current.offsetWidth;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const spaceBelow = vh - anchor.bottom;
      const spaceAbove = anchor.top;
      let top = anchor.bottom + 4;
      let left = anchor.right - menuW;
      if (spaceBelow < menuH + 12 && spaceAbove > spaceBelow) {
        top = anchor.top - menuH - 4;
      }
      if (left < 8) left = 8;
      if (left + menuW > vw - 8) left = vw - menuW - 8;
      if (top < 8) top = 8;
      if (top + menuH > vh - 8) top = vh - menuH - 8;
      setPos({ top, left });
    }, [anchor]);

    return html`<div
      ref=${ref}
      className="coll-card-menu-pop row-menu-floating"
      data-testid=${'collection-menu-pop-' + c.slug}
      style=${{
        position: 'fixed',
        top: (pos?.top ?? -9999) + 'px',
        left: (pos?.left ?? -9999) + 'px',
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
      onClick=${(e) => e.stopPropagation()}
    >
      <button onClick=${onEdit} data-testid=${'collection-edit-' + c.slug}>Renombrar / Cambiar foto</button>
      <button onClick=${onCopyUrl} data-testid=${'collection-copy-url-' + c.slug}>Copiar URL</button>
      ${url ? html`<a href=${url} target="_blank" rel="noreferrer" onClick=${onClose} data-testid=${'collection-open-' + c.slug}>Abrir en pestaña</a>` : null}
      <button className="danger" onClick=${onDelete} data-testid=${'collection-delete-' + c.slug}>Eliminar</button>
    </div>`;
  }

  // Modal crear/editar colección
  function CollectionModal({ initial, onClose, onSaved }) {
    const isEdit = !!initial.id;
    const [nombre, setNombre] = useState(initial.nombre || '');
    // Sanitización defensiva: si `initial.foto_url` apunta a la carpeta
    // `/tenants/.../properties/` (foto de propiedad asignada como cover por
    // alguna versión antigua o backfill manual), tratarla como NO existente.
    // El usuario debe subir explícitamente una foto propia de la colección.
    const [fotoUrl, setFotoUrl] = useState(safeCollectionPhoto(initial.foto_url));
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
                <button type="button" className="rm" onClick=${() => setFotoUrl('')} data-testid="collection-photo-remove">×</button>
              </div>` : html`<div className="coll-photo-preview coll-photo-preview-empty" data-testid="collection-photo-empty">
                <div className="coll-card-cover-placeholder">${(nombre || initial.nombre || '?').charAt(0).toUpperCase()}</div>
              </div>`}
              <label className="photo-uploader" style=${{ width: '120px', flex: '0 0 120px' }}>
                <input type="file" accept="image/*" onChange=${(e) => onUpload(e.target.files[0])} data-testid="collection-photo-input" />
                <div>${uploading ? 'Subiendo…' : (fotoUrl ? '↺ Reemplazar' : '＋ Subir foto')}</div>
              </label>
            </div>
            <span className="form-help">Si no subes foto, en el grid aparecerá la inicial del nombre como marcador.</span>
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
      { id: 'brand', label: 'Marca' },
      { id: 'widget', label: 'Widget de contacto' },
      { id: 'api', label: 'API' },
    ];
    return html`<${Fragment}>
      <div className="page-header"><div>
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Ajusta tu dominio, marca y widget de contacto.</p>
      </div></div>
      <div className="settings-tabs">
        ${tabs.map((t) => html`<button
          key=${t.id}
          data-testid=${'settings-tab-' + t.id}
          className=${'settings-tab' + (tab === t.id ? ' active' : '')}
          onClick=${() => setTab(t.id)}
        >${t.label}</button>`)}
      </div>
      ${tab === 'domain' ? html`<${DomainTab} ctx=${ctx} />` : null}
      ${tab === 'brand' ? html`<${BrandTab} ctx=${ctx} />` : null}
      ${tab === 'widget' ? html`<${WidgetTab} ctx=${ctx} />` : null}
      ${tab === 'api' ? html`<${ApiTab} ctx=${ctx} />` : null}
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
  // BrandTab — Paso 11
  // -------------------------------------------------------------------
  function useBrand() {
    const [state, setState] = useState({ loading: true, marca: null });
    const reload = useCallback(async () => {
      const d = await api('/brand');
      setState({ loading: false, marca: d.marca || {} });
    }, []);
    useEffect(() => { reload(); }, [reload]);
    return [state, setState, reload];
  }

  function BrandTab({ ctx }) {
    const [bs, setBs] = useBrand();
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState({}); // { logo: bool, hero: bool, asoc: bool }

    if (bs.loading) return html`<div className="card">Cargando…</div>`;
    const m = bs.marca;
    const set = (k, v) => setBs((s) => ({ ...s, marca: { ...s.marca, [k]: v } }));

    const upload = async (file, slot) => {
      if (!file) return null;
      setUploading((u) => ({ ...u, [slot]: true }));
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
        return j.eager?.[0]?.secure_url || j.secure_url;
      } catch (e) {
        toast('Error subiendo imagen: ' + (e.message || e), 'error');
        return null;
      } finally {
        setUploading((u) => ({ ...u, [slot]: false }));
      }
    };

    const onLogo = async (file) => { const u = await upload(file, 'logo'); if (u) set('logo_url', u); };
    const onHero = async (file) => { const u = await upload(file, 'hero'); if (u) set('hero_foto_url', u); };
    const onAsocAdd = async (file) => {
      const u = await upload(file, 'asoc');
      if (!u) return;
      const name = prompt('Nombre de la asociación (ej. AMPI, CANACO)') || 'Asociación';
      const list = Array.isArray(m.asociaciones) ? m.asociaciones : [];
      set('asociaciones', [...list, { nombre: name.trim(), logo_url: u }]);
    };
    const onAsocRemove = (i) => {
      const list = Array.isArray(m.asociaciones) ? m.asociaciones : [];
      set('asociaciones', list.filter((_, idx) => idx !== i));
    };

    const onSave = async (e) => {
      e?.preventDefault?.();
      setSaving(true);
      try {
        // No incluimos campos de widget acá — los maneja WidgetTab
        const payload = { ...m };
        delete payload.widget_tipo;
        delete payload.widget_valor;
        delete payload.id; delete payload.tenant_id; delete payload.created_at; delete payload.updated_at;
        await api('/brand', { method: 'PUT', body: payload });
        toast('Marca guardada ✓', 'success');
      } catch (err) {
        toast(err.detail?.message || err.message, 'error');
      } finally { setSaving(false); }
    };

    const sub = ctx.portal?.subdominio;
    const previewHref = sub && ctx.portal?.activo
      ? `https://${sub}/`
      : `/?preview=${ctx.tenant.id}`;

    return html`<form className="card brand-card" onSubmit=${onSave}>
      <div className="brand-section">
        <h2 className="card-title">Identidad visual</h2>
        <div className="brand-images">
          <${ImageUpload}
            label="Logo de la agencia"
            value=${m.logo_url}
            uploading=${uploading.logo}
            onFile=${onLogo}
            onClear=${() => set('logo_url', null)}
            testid="brand-logo"
          />
          <${ImageUpload}
            label="Hero del home"
            value=${m.hero_foto_url}
            uploading=${uploading.hero}
            onFile=${onHero}
            onClear=${() => set('hero_foto_url', null)}
            wide=${true}
            testid="brand-hero"
          />
        </div>
        <div className="brand-colors">
          <${ColorField} label="Color principal" value=${m.color_principal} onChange=${(v) => set('color_principal', v)} testid="brand-color-primary" />
          <${ColorField} label="Color secundario" value=${m.color_secundario} onChange=${(v) => set('color_secundario', v)} testid="brand-color-secondary" />
          <${ColorField} label="Color de acento" value=${m.color_acento} onChange=${(v) => set('color_acento', v)} testid="brand-color-accent" />
        </div>
      </div>

      <div className="brand-section">
        <h2 className="card-title">Datos de contacto</h2>
        <div className="brand-grid">
          <${TextField} label="Nombre de la agencia" value=${m.nombre_agencia} onChange=${(v) => set('nombre_agencia', v)} testid="brand-name" full />
          <${TextField} label="Teléfono" value=${m.telefono} onChange=${(v) => set('telefono', v)} testid="brand-phone" placeholder="+52 998 ..." />
          <${TextField} label="WhatsApp" value=${m.whatsapp} onChange=${(v) => set('whatsapp', v)} testid="brand-whatsapp" placeholder="+52 998 ..." />
          <${TextField} label="Email" value=${m.email} onChange=${(v) => set('email', v)} testid="brand-email" type="email" full />
        </div>
      </div>

      <div className="brand-section">
        <h2 className="card-title">Redes sociales</h2>
        <div className="brand-grid">
          <${TextField} label="Facebook" value=${m.facebook} onChange=${(v) => set('facebook', v)} placeholder="https://facebook.com/..." />
          <${TextField} label="Instagram" value=${m.instagram} onChange=${(v) => set('instagram', v)} placeholder="https://instagram.com/..." />
          <${TextField} label="LinkedIn" value=${m.linkedin} onChange=${(v) => set('linkedin', v)} placeholder="https://linkedin.com/..." />
          <${TextField} label="YouTube" value=${m.youtube} onChange=${(v) => set('youtube', v)} placeholder="https://youtube.com/..." />
        </div>
      </div>

      <div className="brand-section">
        <h2 className="card-title">Asociaciones</h2>
        <p className="card-help">Logos que aparecerán en el footer (AMPI, CANACO, etc.).</p>
        <div className="asoc-grid">
          ${(Array.isArray(m.asociaciones) ? m.asociaciones : []).map((a, i) => html`
            <div key=${i} className="asoc-chip">
              <img src=${a.logo_url} alt=${a.nombre} />
              <span>${a.nombre}</span>
              <button type="button" className="rm" onClick=${() => onAsocRemove(i)}>×</button>
            </div>`)}
          <label className="asoc-add">
            <input type="file" accept="image/*" onChange=${(e) => onAsocAdd(e.target.files[0])} />
            <span>${uploading.asoc ? 'Subiendo…' : '＋ Agregar'}</span>
          </label>
        </div>
      </div>

      <div className="brand-section">
        <h2 className="card-title">Analytics</h2>
        <${TextField} label="Google Analytics GA4 tag (opcional)" value=${m.ga4_tag} onChange=${(v) => set('ga4_tag', v)} placeholder="G-XXXXXXXXXX" testid="brand-ga4" full />
      </div>

      <div className="action-bar" style=${{ position: 'sticky', bottom: 0, background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', padding: '14px 0', margin: '0 -24px -24px', justifyContent: 'space-between' }}>
        <a href=${previewHref} target="_blank" rel="noopener" className="btn btn-ghost">Vista previa</a>
        <button data-testid="brand-save-btn" type="submit" className="btn btn-primary" disabled=${saving}>${saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>`;
  }

  // -------------------------------------------------------------------
  // WidgetTab — Paso 11
  // -------------------------------------------------------------------
  function WidgetTab(/* { ctx } */) {
    const [bs, setBs] = useBrand();
    const [saving, setSaving] = useState(false);
    if (bs.loading) return html`<div className="card">Cargando…</div>`;
    const m = bs.marca || {};
    const tipo = m.widget_tipo || 'whatsapp';
    const setTipo = (t) => setBs((s) => ({ ...s, marca: { ...s.marca, widget_tipo: t } }));
    const setValor = (v) => setBs((s) => ({ ...s, marca: { ...s.marca, widget_valor: v } }));

    const onSave = async (e) => {
      e.preventDefault();
      setSaving(true);
      try {
        await api('/brand', { method: 'PUT', body: { widget_tipo: tipo, widget_valor: m.widget_valor || null } });
        toast('Widget guardado ✓', 'success');
      } catch (err) {
        toast(err.detail?.message || err.message, 'error');
      } finally { setSaving(false); }
    };

    return html`<form className="card" onSubmit=${onSave} style=${{ padding: '24px' }}>
      <h2 className="card-title">Widget de contacto</h2>
      <p className="card-help">Elige UNO. Aparecerá flotante en todas las páginas públicas del portal.</p>

      <div className="widget-options">
        <label className=${'widget-option' + (tipo === 'whatsapp' ? ' active' : '')}>
          <input type="radio" name="widget_tipo" value="whatsapp" checked=${tipo === 'whatsapp'} onChange=${() => setTipo('whatsapp')} data-testid="widget-radio-whatsapp" />
          <div>
            <div className="widget-option-name">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#25d366" style=${{ verticalAlign: '-4px', marginRight: '6px' }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.149-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
              WhatsApp flotante
            </div>
            <div className="widget-option-help">Botón verde fijo en cada página del portal. Bottom bar full-width en móvil.</div>
          </div>
        </label>

        <label className=${'widget-option' + (tipo === 'livechat' ? ' active' : '')}>
          <input type="radio" name="widget_tipo" value="livechat" checked=${tipo === 'livechat'} onChange=${() => setTipo('livechat')} data-testid="widget-radio-livechat" />
          <div>
            <div className="widget-option-name">GHL Live Chat</div>
            <div className="widget-option-help">Embebe el chat nativo de GoHighLevel. Los leads entran directo a tu CRM y disparan workflows.</div>
          </div>
        </label>
      </div>

      ${tipo === 'whatsapp' ? html`<div className="widget-config">
        <label className="form-label">Número de WhatsApp</label>
        <input
          data-testid="widget-whatsapp-input"
          className="form-input"
          placeholder="+52 998 123 4567"
          value=${m.widget_valor || ''}
          onInput=${(e) => setValor(e.target.value)}
        />
        <span className="form-help">Incluye el código de país (+52 para México).</span>
      </div>` : html`<div className="widget-config">
        <label className="form-label">Snippet HTML del Live Chat de GHL</label>
        <textarea
          data-testid="widget-livechat-input"
          className="form-input"
          rows="6"
          placeholder='<script src="https://widget.leadconnectorhq.com/loader.js" data-resources-url="..." data-widget-id="..."></script>'
          value=${m.widget_valor || ''}
          onInput=${(e) => setValor(e.target.value)}
          style=${{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px' }}
        ></textarea>
        <span className="form-help">Cópialo desde GHL → Sites → Chat Widget → Embed.</span>
        <div className="next-step" style=${{ marginTop: '10px' }}>
          <strong>Nota:</strong> Al activar Live Chat, el botón WhatsApp flotante se oculta automáticamente en el portal público.
        </div>
      </div>`}

      <div className="action-bar" style=${{ position: 'static', margin: '20px -24px -24px', padding: '14px 24px', borderTop: '1px solid var(--color-border)' }}>
        <button data-testid="widget-save-btn" type="submit" className="btn btn-primary" disabled=${saving}>${saving ? 'Guardando…' : 'Guardar widget'}</button>
      </div>
    </form>`;
  }

  // -------------------------------------------------------------------
  // ApiTab — Paso 14: gestión de API keys del tenant
  // -------------------------------------------------------------------
  function ApiTab(/* { ctx } */) {
    const [state, setState] = useState({ loading: true, keys: [], error: null });
    const [nombre, setNombre] = useState('');
    const [creating, setCreating] = useState(false);
    const [revealed, setRevealed] = useState(null); // {id, plain, nombre} — sólo en memoria, hasta cerrar modal
    const [copied, setCopied] = useState(false);

    const apiBase = (typeof window !== 'undefined') ? (window.location.origin + '/api/v1') : '/api/v1';
    const docsUrl = (typeof window !== 'undefined') ? (window.location.origin + '/api/v1/docs') : '/api/v1/docs';

    const reload = useCallback(async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const r = await api('/apikeys');
        setState({ loading: false, keys: r.api_keys || [], error: null });
      } catch (err) {
        setState({ loading: false, keys: [], error: err.detail?.error || err.message });
      }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const onCreate = async (e) => {
      e.preventDefault();
      const nm = nombre.trim();
      if (!nm) { toast('Dale un nombre a la API key', 'error'); return; }
      setCreating(true);
      try {
        const r = await api('/apikeys', { method: 'POST', body: { nombre: nm } });
        setRevealed({ id: r.api_key.id, plain: r.plain_once, nombre: r.api_key.nombre });
        setNombre('');
        setCopied(false);
        await reload();
      } catch (err) {
        toast(err.detail?.message || err.message, 'error');
      } finally { setCreating(false); }
    };

    const onToggle = async (k) => {
      try {
        await api('/apikeys/' + k.id, { method: 'PUT', body: { activa: !k.activa } });
        toast(k.activa ? 'API key desactivada' : 'API key reactivada', 'success');
        await reload();
      } catch (err) { toast(err.detail?.message || err.message, 'error'); }
    };

    const onDelete = async (k) => {
      if (!window.confirm('¿Eliminar permanentemente la key "' + k.nombre + '"? Esto revoca el acceso de inmediato.')) return;
      try {
        await api('/apikeys/' + k.id, { method: 'DELETE' });
        toast('API key eliminada', 'success');
        await reload();
      } catch (err) { toast(err.detail?.message || err.message, 'error'); }
    };

    const copyPlain = async () => {
      if (!revealed?.plain) return;
      try {
        await navigator.clipboard.writeText(revealed.plain);
        setCopied(true);
        toast('Copiado al portapapeles ✓', 'success');
      } catch {
        toast('No se pudo copiar — selecciónalo manualmente', 'error');
      }
    };

    return html`<${Fragment}>
      <div className="card" style=${{ padding: '24px' }}>
        <h2 className="card-title">API pública v1</h2>
        <p className="card-help">
          Conecta tu inventario con sitios externos, CRMs, MLS o automatizaciones.
          Cada key está vinculada a tu tenant y puedes revocarla en cualquier momento.
        </p>

        <div className="next-step" style=${{ marginTop: '12px' }}>
          <div><strong>Base URL:</strong> <code data-testid="api-base-url">${apiBase}</code></div>
          <div style=${{ marginTop: '4px' }}><strong>Documentación:</strong> <a data-testid="api-docs-link" href=${docsUrl} target="_blank" rel="noopener">${docsUrl}</a></div>
        </div>

        <form onSubmit=${onCreate} style=${{ display: 'flex', gap: '8px', alignItems: 'end', margin: '18px 0 6px' }}>
          <div style=${{ flex: 1 }}>
            <label className="form-label">Nombre de la nueva API key</label>
            <input
              data-testid="api-key-name-input"
              className="form-input"
              placeholder="Ej: Web pública 2026, Integración Zapier…"
              value=${nombre}
              onInput=${(e) => setNombre(e.target.value)}
              maxLength="80"
            />
          </div>
          <button
            data-testid="api-key-create-btn"
            type="submit"
            className="btn btn-primary"
            disabled=${creating || !nombre.trim()}
          >${creating ? 'Generando…' : 'Generar API key'}</button>
        </form>
        <span className="form-help">La key completa solo se muestra una vez al crearla. Guárdala en un lugar seguro.</span>
      </div>

      <div className="card" style=${{ padding: '24px', marginTop: '16px' }}>
        <h3 className="card-title" style=${{ fontSize: '15px' }}>Tus API keys</h3>
        ${state.loading ? html`<div>Cargando…</div>` : null}
        ${state.error ? html`<div className="next-step" style=${{ background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>Error: ${state.error}</div>` : null}
        ${!state.loading && !state.error && state.keys.length === 0 ? html`<p className="card-help">Aún no has generado ninguna key. Crea la primera arriba.</p>` : null}

        ${state.keys.length > 0 ? html`<table className="listings-table" data-testid="api-keys-table" style=${{ marginTop: '8px', minWidth: 0 }}>
          <thead><tr>
            <th>Nombre</th><th>Prefix</th><th>Estado</th><th>Último uso</th><th>Creada</th><th style=${{ textAlign: 'right' }}>Acciones</th>
          </tr></thead>
          <tbody>
            ${state.keys.map((k) => html`<tr key=${k.id} data-testid=${'api-key-row-' + k.id}>
              <td>${k.nombre}</td>
              <td><code style=${{ fontSize: '12px' }}>${k.key_prefix}…</code></td>
              <td>
                <span className=${'pill ' + (k.activa ? 'pill-active' : 'pill-paused')}>
                  ${k.activa ? 'Activa' : 'Desactivada'}
                </span>
              </td>
              <td style=${{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                ${k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}
              </td>
              <td style=${{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                ${k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}
              </td>
              <td style=${{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button
                  data-testid=${'api-key-toggle-' + k.id}
                  className="btn btn-ghost"
                  style=${{ padding: '4px 10px', fontSize: '12px' }}
                  onClick=${() => onToggle(k)}
                >${k.activa ? 'Desactivar' : 'Reactivar'}</button>
                <button
                  data-testid=${'api-key-delete-' + k.id}
                  className="btn btn-ghost"
                  style=${{ color: '#c0392b', marginLeft: '6px', padding: '4px 10px', fontSize: '12px' }}
                  onClick=${() => onDelete(k)}
                >Eliminar</button>
              </td>
            </tr>`)}
          </tbody>
        </table>` : null}
      </div>

      ${revealed ? html`<div className="modal-backdrop" onClick=${() => setRevealed(null)} data-testid="api-key-reveal-modal">
        <div className="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '560px', padding: '24px' }}>
          <h3 style=${{ marginTop: 0 }}>Tu API key fue creada</h3>
          <p>Esta es la <strong>única vez</strong> que verás la key completa. Cópiala y guárdala en un gestor seguro — si la pierdes, deberás crear una nueva.</p>
          <div style=${{
            background: '#0f172a', color: '#f1f5f9', padding: '12px 14px',
            borderRadius: '6px', fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '13px', wordBreak: 'break-all', userSelect: 'all',
          }} data-testid="api-key-plain">${revealed.plain}</div>
          <div style=${{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button
              data-testid="api-key-copy-btn"
              className="btn btn-primary"
              onClick=${copyPlain}
            >${copied ? 'Copiado ✓' : 'Copiar al portapapeles'}</button>
            <button
              data-testid="api-key-reveal-close"
              className="btn btn-ghost"
              onClick=${() => setRevealed(null)}
            >Cerrar</button>
          </div>
          <div style=${{ marginTop: '14px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            <strong>Ejemplo de uso:</strong>
            <pre style=${{ background: '#f8fafc', padding: '10px', borderRadius: '4px', overflowX: 'auto', marginTop: '6px' }}>curl -H "X-API-Key: ${revealed.plain}" \\
  "${apiBase}/properties?limit=5"</pre>
          </div>
        </div>
      </div>` : null}
    <//>`;
  }


  function ImageUpload({ label, value, uploading, onFile, onClear, wide, testid }) {
    return html`<div className="img-up">
      <div className="form-label">${label}</div>
      ${value ? html`<div className=${'img-up-preview' + (wide ? ' wide' : '')}>
        <img src=${value} alt="" />
        <button type="button" className="rm" onClick=${onClear}>×</button>
      </div>` : html`<label className="photo-uploader" style=${{ aspectRatio: wide ? '16/6' : '1', maxWidth: wide ? 'none' : '140px' }}>
        <input type="file" accept="image/*" data-testid=${testid} onChange=${(e) => onFile(e.target.files[0])} />
        <div>${uploading ? 'Subiendo…' : '＋ Subir'}</div>
      </label>`}
    </div>`;
  }

  function ColorField({ label, value, onChange, testid }) {
    return html`<div className="color-field">
      <div className="form-label">${label}</div>
      <div className="color-row">
        <input
          type="color"
          value=${value || '#0f172a'}
          onInput=${(e) => onChange(e.target.value)}
          className="color-picker"
          data-testid=${testid}
        />
        <input
          type="text"
          value=${value || ''}
          onInput=${(e) => onChange(e.target.value)}
          placeholder="#0f172a"
          className="form-input"
          style=${{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px' }}
        />
      </div>
    </div>`;
  }

  function TextField({ label, value, onChange, placeholder, type = 'text', testid, full }) {
    return html`<div className=${'form-field' + (full ? ' full' : '')}>
      <label className="form-label">${label}</label>
      <input
        type=${type}
        className="form-input"
        value=${value || ''}
        onInput=${(e) => onChange(e.target.value)}
        placeholder=${placeholder || ''}
        data-testid=${testid || null}
      />
    </div>`;
  }

  // -------------------------------------------------------------------
  // ListingsPage — Paso 13 (Mis listings + URL orgánica)
  // -------------------------------------------------------------------
  function ListingsPage({ ctx, setPage, goEdit }) {
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState([]);
    const [viewCounts, setViewCounts] = useState({});
    const [filters, setFilters] = useState({ q: '', coleccion: '', estado: '', tipo: '', precio_min: '', precio_max: '', agente: '' });
    const [page, setLocalPage] = useState(1);
    const [openMenu, setOpenMenu] = useState(null); // { id, anchor: {top, left, height} }
    const [shareTarget, setShareTarget] = useState(null);
    const [agentTarget, setAgentTarget] = useState(null); // record cuyo agente cambiar
    const PAGE_SIZE = 20;
    const isAdmin = ctx.session?.agente?.rol === 'admin'; // may be undefined; show always

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        const d = await api('/property?limit=100');
        const recs = d.records || d.data || [];
        setRecords(recs);
        if (recs.length) {
          const ids = recs.map((r) => r.id).join(',');
          const v = await api('/analytics/views?ids=' + encodeURIComponent(ids));
          setViewCounts(v.counts || {});
        }
      } catch (e) {
        toast('Error cargando propiedades: ' + (e.detail?.message || e.message), 'error');
      } finally { setLoading(false); }
    }, []);
    useEffect(() => { reload(); }, [reload]);

    // Cerrar dropdown al clickear fuera o scrollear/resize (excepto si el scroll
    // viene del propio menú floating, que tiene su propio overflow interno).
    useEffect(() => {
      const close = (ev) => {
        if (ev && ev.target && ev.target.closest && ev.target.closest('.row-menu-floating')) return;
        setOpenMenu(null);
      };
      document.addEventListener('click', close);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
      return () => {
        document.removeEventListener('click', close);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
      };
    }, []);

    // Filtrado client-side
    const filtered = (records || []).filter((r) => {
      const p = r.properties || {};
      if (filters.q) {
        const text = [p.titulo, p.direccion_completa, p.colonia, p.ciudad].join(' ').toLowerCase();
        if (!text.includes(filters.q.toLowerCase())) return false;
      }
      if (filters.estado && (p.estado || '').toLowerCase() !== filters.estado.toLowerCase()) return false;
      if (filters.tipo && (p.tipo_inmueble || '').toLowerCase() !== filters.tipo.toLowerCase()) return false;
      if (filters.precio_min && Number(p.precio_usd || 0) < Number(filters.precio_min)) return false;
      if (filters.precio_max && Number(p.precio_usd || 0) > Number(filters.precio_max)) return false;
      if (filters.agente && p.agente_responsable !== filters.agente) return false;
      // colecciones: no tenemos en el record desde GHL — para Fase 1 lo omitimos del filtro
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageRecords = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const agentByUserId = {};
    for (const a of ctx.agentes || []) agentByUserId[a.ghl_user_id] = a;

    const changeEstado = async (rec, nuevo) => {
      try {
        await api('/property/' + rec.id, { method: 'PUT', body: { estado: nuevo } });
        toast(`Estado: ${nuevo} ✓`, 'success');
        await reload();
      } catch (e) { toast(e.detail?.message || e.message, 'error'); }
    };

    const onDelete = async (rec) => {
      if (!confirm(`Eliminar definitivamente "${rec.properties?.titulo || 'propiedad'}"?`)) return;
      try {
        await api('/property/' + rec.id, { method: 'DELETE' });
        toast('Propiedad eliminada', 'success');
        await reload();
      } catch (e) { toast(e.detail?.message || e.message, 'error'); }
    };

    const portalHost = ctx.portal?.subdominio || `localhost:8001/?preview=${ctx.tenant.id}`;
    const portalBase = ctx.portal?.activo ? `https://${ctx.portal.subdominio}` : `http://${portalHost}`;

    return html`<${Fragment}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis listings</h1>
          <p className="page-subtitle">${filtered.length} propiedad${filtered.length === 1 ? '' : 'es'} · ${records.length} en total</p>
        </div>
      </div>

      <div className="listings-filters card">
        <input data-testid="listings-q" className="form-input" placeholder="Buscar por título o dirección" value=${filters.q} onInput=${(e) => { setFilters({ ...filters, q: e.target.value }); setLocalPage(1); }} />
        <select className="form-input" value=${filters.estado} onChange=${(e) => setFilters({ ...filters, estado: e.target.value })}>
          <option value="">Todos los estados</option>
          <option value="Disponible">Disponible</option>
          <option value="Vendida">Vendida</option>
          <option value="Rentada">Rentada</option>
          <option value="Pausada">Pausada</option>
        </select>
        <select className="form-input" value=${filters.tipo} onChange=${(e) => setFilters({ ...filters, tipo: e.target.value })}>
          <option value="">Todos los tipos</option>
          ${['Casa', 'Departamento', 'Local', 'Terreno', 'Oficina', 'Villa', 'Penthouse'].map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
        </select>
        <input type="number" className="form-input" placeholder="Precio mín USD" value=${filters.precio_min} onInput=${(e) => setFilters({ ...filters, precio_min: e.target.value })} />
        <input type="number" className="form-input" placeholder="Precio máx USD" value=${filters.precio_max} onInput=${(e) => setFilters({ ...filters, precio_max: e.target.value })} />
        ${isAdmin ? html`<select className="form-input" value=${filters.agente} onChange=${(e) => setFilters({ ...filters, agente: e.target.value })}>
          <option value="">Todos los agentes</option>
          ${(ctx.agentes || []).map((a) => html`<option key=${a.ghl_user_id} value=${a.ghl_user_id}>${a.nombre}</option>`)}
        </select>` : null}
      </div>

      ${loading ? html`<div className="card">Cargando…</div>` :
        pageRecords.length === 0 ? html`<div className="card"><div className="empty-state"><h3>Sin resultados</h3><p>Prueba ajustar los filtros o crear una nueva propiedad.</p></div></div>` :
        html`<div className="listings-table-wrap card" style=${{ padding: 0, overflow: 'auto' }}>
          <table className="listings-table" data-testid="listings-table">
            <thead><tr>
              <th></th>
              <th>Título</th>
              <th>Precio USD</th>
              <th>Estado</th>
              <th>Vistas</th>
              <th>Agente</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${pageRecords.map((rec) => {
                const p = rec.properties || {};
                const photos = String(p.fotos_urls || '').split('|').filter(Boolean);
                const photo = photos[0] || null;
                const agt = agentByUserId[p.agente_responsable];
                const estado = p.estado || 'Disponible';
                const slug = p.slug_url || rec.id;
                return html`<tr key=${rec.id} data-testid=${'listing-row-' + rec.id}>
                  <td className="thumb">
                    ${photo ? html`<img src=${photo} alt="" />` : html`<div className="thumb-ph"></div>`}
                  </td>
                  <td>
                    <div className="listing-title">${p.titulo || 'Sin título'}</div>
                    <div className="listing-loc">${[p.colonia, p.ciudad].filter(Boolean).join(', ')}</div>
                  </td>
                  <td className="listing-price">${p.precio_a_consultar ? 'A consultar' : ('$' + Number(p.precio_usd || 0).toLocaleString())}</td>
                  <td><span className=${'estado-badge estado-' + estado.toLowerCase()}>${estado}</span></td>
                  <td className="listing-views">${viewCounts[rec.id] || 0}</td>
                  <td>${agt?.nombre || '—'}</td>
                  <td className="listing-actions">
                    <button
                      data-testid=${'listing-menu-' + rec.id}
                      className="ico-btn"
                      onClick=${(e) => {
                        e.stopPropagation();
                        if (openMenu?.id === rec.id) { setOpenMenu(null); return; }
                        const r = e.currentTarget.getBoundingClientRect();
                        setOpenMenu({ id: rec.id, rec, anchor: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height } });
                      }}
                    >···</button>
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>`}

      ${totalPages > 1 ? html`<div className="pagination" data-testid="listings-pagination">
        <button disabled=${page === 1} onClick=${() => setLocalPage(page - 1)}>‹ Anterior</button>
        <span>Página ${page} de ${totalPages}</span>
        <button disabled=${page === totalPages} onClick=${() => setLocalPage(page + 1)}>Siguiente ›</button>
      </div>` : null}

      ${shareTarget ? html`<${ShareModal}
        ctx=${ctx}
        property=${shareTarget}
        onClose=${() => setShareTarget(null)}
      />` : null}

      ${agentTarget ? html`<${ChangeAgentModal}
        ctx=${ctx}
        record=${agentTarget}
        onClose=${() => setAgentTarget(null)}
        onSaved=${async () => { setAgentTarget(null); await reload(); }}
      />` : null}

      ${openMenu ? createPortal(
        h(RowMenuPortal, {
          anchor: openMenu.anchor,
          rec: openMenu.rec,
          ctx,
          portalBase,
          onClose: () => setOpenMenu(null),
          onEdit: () => { setOpenMenu(null); goEdit(openMenu.rec.id); },
          onShare: () => { setOpenMenu(null); setShareTarget(openMenu.rec); },
          onChangeAgent: () => { setOpenMenu(null); setAgentTarget(openMenu.rec); },
          onChangeEstado: (nuevo) => { setOpenMenu(null); changeEstado(openMenu.rec, nuevo); },
          onDelete: () => { setOpenMenu(null); onDelete(openMenu.rec); },
        }),
        document.body
      ) : null}
    <//>`;
  }

  // Floating dropdown menu rendered via portal — flips up when near bottom.
  function RowMenuPortal({ anchor, rec, ctx, portalBase, onClose, onEdit, onShare, onChangeAgent, onChangeEstado, onDelete }) {
    const ref = useRef(null);
    const [pos, setPos] = useState(null);
    const p = rec.properties || {};
    const estado = p.estado || 'Disponible';
    const slug = p.slug_url || rec.id;
    const previewQS = ctx.portal?.activo ? '' : ('&preview=' + ctx.tenant.id);

    // Posicionar tras montar: calcular si cabe debajo o si debe subir.
    useEffect(() => {
      if (!ref.current) return;
      const menuH = ref.current.offsetHeight;
      const menuW = ref.current.offsetWidth;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const spaceBelow = vh - anchor.bottom;
      const spaceAbove = anchor.top;
      // Por defecto se abre HACIA ABAJO debajo del botón, alineado a la derecha.
      let top = anchor.bottom + 4;
      let left = anchor.right - menuW;
      // Si no cabe abajo pero sí arriba, flip-up.
      if (spaceBelow < menuH + 12 && spaceAbove > spaceBelow) {
        top = anchor.top - menuH - 4;
      }
      // Mantener dentro del viewport horizontalmente
      if (left < 8) left = 8;
      if (left + menuW > vw - 8) left = vw - menuW - 8;
      // Mantener dentro verticalmente (caso extremo)
      if (top < 8) top = 8;
      if (top + menuH > vh - 8) top = vh - menuH - 8;
      setPos({ top, left });
    }, [anchor]);

    return html`<div
      ref=${ref}
      className="row-menu row-menu-floating"
      data-testid=${'listing-menu-pop-' + rec.id}
      style=${{
        position: 'fixed',
        top: (pos?.top ?? -9999) + 'px',
        left: (pos?.left ?? -9999) + 'px',
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
      onClick=${(e) => e.stopPropagation()}
    >
      <a href=${portalBase + '/p/' + slug} target="_blank" rel="noopener" data-testid=${'listing-view-' + rec.id}>Ver propiedad</a>
      <button onClick=${onEdit} data-testid=${'listing-edit-' + rec.id}>Editar</button>
      <button onClick=${onChangeAgent} data-testid=${'listing-change-agent-' + rec.id}>Cambiar agente</button>
      <button onClick=${onShare} data-testid=${'share-btn-' + rec.id}>URL orgánica</button>
      <div className="row-menu-sep">PDF</div>
      <a href=${'/p/' + slug + '/pdf?v=con-agente-1pag' + previewQS} target="_blank" rel="noopener">Con datos · 1 pág</a>
      <a href=${'/p/' + slug + '/pdf?v=con-agente-2pag' + previewQS} target="_blank" rel="noopener">Con datos · 2 págs</a>
      <a href=${'/p/' + slug + '/pdf?v=sin-agente-1pag' + previewQS} target="_blank" rel="noopener">Orgánico · 1 pág</a>
      <a href=${'/p/' + slug + '/pdf?v=sin-agente-2pag' + previewQS} target="_blank" rel="noopener">Orgánico · 2 págs</a>
      <div className="row-menu-sep">Cambiar estado</div>
      ${estado !== 'Disponible' ? html`<button onClick=${() => onChangeEstado('Disponible')}>Publicar (Disponible)</button>` : null}
      ${estado !== 'Pausada' ? html`<button onClick=${() => onChangeEstado('Pausada')}>Pausar</button>` : null}
      ${estado !== 'Vendida' ? html`<button onClick=${() => onChangeEstado('Vendida')}>Marcar vendida</button>` : null}
      ${estado !== 'Rentada' ? html`<button onClick=${() => onChangeEstado('Rentada')}>Marcar rentada</button>` : null}
      <div className="row-menu-sep"></div>
      <button className="danger" onClick=${onDelete} data-testid=${'listing-delete-' + rec.id}>Eliminar</button>
    </div>`;
  }

  // Modal "Cambiar agente" — dropdown de agentes activos + guardar.
  function ChangeAgentModal({ ctx, record, onClose, onSaved }) {
    const agentes = (ctx.agentes || []).filter((a) => a.activo !== false);
    const current = record?.properties?.agente_responsable || '';
    const [selected, setSelected] = useState(current);
    const [saving, setSaving] = useState(false);

    const onSave = async () => {
      if (!selected) { toast('Selecciona un agente', 'error'); return; }
      if (selected === current) { toast('Es el mismo agente actual', 'info'); return; }
      setSaving(true);
      try {
        await api('/property/' + record.id, { method: 'PUT', body: { agente_responsable: selected } });
        toast('Agente actualizado ✓', 'success');
        if (onSaved) onSaved();
      } catch (e) {
        toast('Error: ' + (e.detail?.message || e.message), 'error');
      } finally { setSaving(false); }
    };

    return html`<div className="modal-backdrop" onClick=${onClose} data-testid="change-agent-modal">
      <div className="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '440px', padding: '24px' }}>
        <h3 style=${{ marginTop: 0 }}>Cambiar agente</h3>
        <p className="card-help" style=${{ marginBottom: '14px' }}>
          Reasigna esta propiedad a otro agente del equipo. Se actualizará en GHL inmediatamente.
        </p>
        <label className="form-label">Agente responsable</label>
        <select
          data-testid="change-agent-select"
          className="form-input"
          value=${selected}
          onChange=${(e) => setSelected(e.target.value)}
        >
          <option value="">— Selecciona —</option>
          ${agentes.map((a) => html`<option key=${a.ghl_user_id} value=${a.ghl_user_id}>${a.nombre}${a.email ? ' · ' + a.email : ''}</option>`)}
        </select>
        <div style=${{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
          <button data-testid="change-agent-cancel" className="btn btn-ghost" onClick=${onClose}>Cancelar</button>
          <button data-testid="change-agent-save" className="btn btn-primary" disabled=${saving} onClick=${onSave}>${saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>`;
  }

  // Modal URL orgánica
  function ShareModal({ ctx, property, onClose }) {
    const [loading, setLoading] = useState(true);
    const [ficha, setFicha] = useState(null);
    const [cnameTarget, setCnameTarget] = useState('');
    const [expiraEn, setExpiraEn] = useState('');
    const [saving, setSaving] = useState(false);

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        const d = await api('/share/' + property.id);
        setFicha(d.ficha);
        setCnameTarget(d.cname_target);
        setExpiraEn(d.ficha?.expira_en ? String(d.ficha.expira_en).slice(0, 10) : '');
      } finally { setLoading(false); }
    }, [property.id]);
    useEffect(() => { reload(); }, [reload]);

    const generate = async (regenerate = false) => {
      setSaving(true);
      try {
        const d = await api('/share/' + property.id, { method: 'POST', body: { regenerate, expira_en: expiraEn || null } });
        setFicha(d.ficha);
        toast(regenerate ? 'URL regenerada — la anterior fue desactivada' : 'URL orgánica creada ✓', 'success');
      } catch (e) { toast(e.detail?.message || e.message, 'error'); }
      finally { setSaving(false); }
    };

    const updateField = async (fields) => {
      if (!ficha) return;
      setSaving(true);
      try {
        const d = await api('/share/by-id/' + ficha.id, { method: 'PUT', body: fields });
        setFicha(d.ficha);
        toast('Actualizado ✓', 'success');
      } catch (e) { toast(e.detail?.message || e.message, 'error'); }
      finally { setSaving(false); }
    };

    const copyUrl = async () => {
      if (!ficha?.url) return;
      try { await navigator.clipboard.writeText(ficha.url); toast('URL copiada ✓', 'success'); }
      catch { toast('No pude copiar', 'error'); }
    };

    return html`<div className="modal-backdrop" onClick=${onClose}>
      <div className="modal" onClick=${(e) => e.stopPropagation()} data-testid="share-modal" style=${{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2>URL orgánica</h2>
          <button className="modal-close" onClick=${onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="card-help" style=${{ margin: '0 0 14px' }}>
            URL neutra para compartir con colegas — sin tu marca ni datos de contacto.
            La página de destino expira o se desactiva a tu criterio.
          </p>
          ${loading ? html`<div>Cargando…</div>` : !ficha ? html`<div>
            <div className="share-empty">
              <p>Esta propiedad aún no tiene URL orgánica.</p>
              <div className="form-field" style=${{ maxWidth: '220px' }}>
                <label className="form-label">Expiración (opcional)</label>
                <input type="date" className="form-input" value=${expiraEn} onInput=${(e) => setExpiraEn(e.target.value)} />
              </div>
              <button data-testid="generate-share-btn" className="btn btn-primary" onClick=${() => generate(false)} disabled=${saving}>${saving ? 'Generando…' : 'Generar URL orgánica'}</button>
            </div>
          </div>` : html`<${Fragment}>
            <div className="share-url-box">
              <div className="share-url-label">Tu URL orgánica</div>
              <div className="share-url-row">
                <code data-testid="share-url">${ficha.url}</code>
                <button className="btn btn-ghost" onClick=${copyUrl}>Copiar</button>
              </div>
              <div className="share-stats">
                <span><strong>${ficha.vistas}</strong> vista${ficha.vistas === 1 ? '' : 's'}</span>
                <span className=${'estado-badge ' + (ficha.activa ? 'estado-disponible' : 'estado-pausada')}>${ficha.activa ? 'Activa' : 'Inactiva'}</span>
              </div>
            </div>

            <div className="share-controls">
              <div className="form-field">
                <label className="form-label">Fecha de expiración (opcional)</label>
                <input type="date" className="form-input" value=${expiraEn} onInput=${(e) => setExpiraEn(e.target.value)} onBlur=${() => updateField({ expira_en: expiraEn || null })} />
                <span className="form-help">Tras esta fecha la página devolverá 404.</span>
              </div>

              <div className="form-field">
                <label className="form-toggle">
                  <input type="checkbox" checked=${ficha.activa} onChange=${(e) => updateField({ activa: e.target.checked })} />
                  <span>URL activa (desactivar la deja inservible sin borrarla)</span>
                </label>
              </div>
            </div>

            <div className="share-actions">
              <button className="btn btn-ghost danger" onClick=${() => { if (confirm('Esto generará una URL NUEVA y desactivará la anterior. ¿Continuar?')) generate(true); }} disabled=${saving}>Regenerar (cambia la URL)</button>
              <a href=${ficha.portal_path} target="_blank" rel="noopener" className="btn btn-ghost">Vista previa</a>
            </div>
          <//>`}
        </div>
      </div>
    </div>`;
  }

  // -------------------------------------------------------------------
  // App root
  // -------------------------------------------------------------------
  function App() {
    const boot = useBootstrap();
    const [page, _setPage] = useState('new');
    const [editingId, setEditingId] = useState(null);
    const [mobile, setMobile] = useState(false);
    // setPage wrapper: si navegas a algo que NO sea 'edit', limpia editingId.
    const setPage = useCallback((p) => {
      if (p !== 'edit') setEditingId(null);
      _setPage(p);
    }, []);
    const goEdit = useCallback((id) => {
      setEditingId(id);
      _setPage('edit');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);
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
      session: boot.session,
      portal: boot.portal,
    };

    let body;
    switch (page) {
      case 'dashboard': body = html`<${Dashboard} ctx=${ctx} />`; break;
      case 'new': body = html`<${NewPropertyPage} ctx=${ctx} />`; break;
      case 'edit': body = html`<${NewPropertyPage} ctx=${ctx} editingId=${editingId} onAfterSave=${() => setPage('listings')} />`; break;
      case 'listings': body = html`<${ListingsPage} ctx=${ctx} setPage=${setPage} goEdit=${goEdit} />`; break;
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
