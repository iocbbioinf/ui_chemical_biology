import { useState, useRef } from 'react'
import './App.css'
import { parseMzML } from './parseMzML.js'
import SpectrumGraph from './SpectrumGraph.jsx'
import SpectrumPage, { SpectrumDetail } from './SpectrumPage.jsx'
import TagInput, { DATASET_TYPE_SUGGESTIONS, SPECIES_SUGGESTIONS, PTM_SUGGESTIONS } from './TagInput.jsx'
import DatasetPage from './DatasetPage.jsx'
import MsrunPage from './MsrunPage.jsx'
import { rdmBase } from './utils.js'

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  // ── auth state ────────────────────────────────────────────────────────────
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [token, setToken]         = useState('')
  const [user, setUser]           = useState(null)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  // ── tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('search')

  // ── mzML folder import state ──────────────────────────────────────────────
  const [importFiles, setImportFiles]   = useState([])
  const [datasetTitle, setDatasetTitle] = useState('')
  const [datasetDescription, setDatasetDescription] = useState('')
  const [datasetType, setDatasetType]   = useState([])
  const [datasetSpecies, setDatasetSpecies] = useState([])
  const [datasetPTMs, setDatasetPTMs]   = useState([])
  const [datasetKeywords, setDatasetKeywords] = useState([])
  const [piName, setPiName]             = useState('')
  const [piEmail, setPiEmail]           = useState('')
  const [piInstitution, setPiInstitution] = useState('')
  const [piCountry, setPiCountry]       = useState('')
  const [importing, setImporting]       = useState(false)
  const [importLog, setImportLog]       = useState([])
  const folderInputRef = useRef(null)

  // ── spectra search state ──────────────────────────────────────────────────
  const [precursorMzMin, setPrecursorMzMin] = useState('')
  const [precursorMzMax, setPrecursorMzMax] = useState('')
  const [formula, setFormula]               = useState('')
  const [organism, setOrganism]             = useState('')
  const [searching, setSearching]           = useState(false)
  const [searchResults, setSearchResults]   = useState(null)
  const [searchError, setSearchError]       = useState('')
  const [sortCol, setSortCol]               = useState(null)
  const [sortDir, setSortDir]               = useState('asc')
  const [spectraPage, setSpectraPage]       = useState(0)
  const [spectrumPage, setSpectrumPage]     = useState(null)
  const [msrunPage, setMsrunPage]           = useState(null)
  const [datasetPage, setDatasetPage]       = useState(null)

  // ── mzML file search state ────────────────────────────────────────────────
  const [mzFile, setMzFile]                   = useState(null)
  const [mzSearching, setMzSearching]         = useState(false)
  const [mzSearchError, setMzSearchError]     = useState('')
  const [mzSearchProgress, setMzSearchProgress] = useState('')
  const [mzSearchResults, setMzSearchResults] = useState(null)
  const [localSpectrumPage, setLocalSpectrumPage] = useState(null)
  const mzFileInputRef                        = useRef(null)


  // ── helpers ───────────────────────────────────────────────────────────────

  function randFloat() {
    return (Math.random() * 2 - 1).toFixed(6)
  }

  async function apiFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    }
    const res = await fetch(path, { ...options, headers })
    const json = await res.json()
    return { ok: res.ok, status: res.status, json }
  }

  async function createAndPublish(path, payload, label, log, serverMs) {
    const t0 = performance.now()
    const draft = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
    if (serverMs) serverMs.total += performance.now() - t0
    if (!draft.ok) {
      log(`  ✗ ${label} draft failed: ${JSON.stringify(draft.json)}`)
      return null
    }
    const id = draft.json.id
    const t1 = performance.now()
    const pub = await apiFetch(`${path}/${id}/draft/actions/publish`, { method: 'POST' })
    if (serverMs) serverMs.total += performance.now() - t1
    if (!pub.ok) {
      log(`  ✗ ${label} publish failed: ${JSON.stringify(pub.json)}`)
      return null
    }
    log(`  ✓ ${label} published: ${pub.json.id}`)
    return pub.json.id
  }

  // ── login / logout ────────────────────────────────────────────────────────

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    setLoggingIn(true)
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json()
    if (!res.ok) { setLoginError(json.message || `Login failed (${res.status})`); setLoggingIn(false); return }
    setToken(json.token)
    setUser({ email: json.email })
    setLoggingIn(false)
    setShowLoginModal(false)
    setEmail('')
    setPassword('')
  }

  function handleLogout() {
    setUser(null); setToken(''); setEmail(''); setPassword('')
    setImportLog([]); setSearchResults(null)
    if (activeTab === 'import') setActiveTab('search')
  }

  // ── mzML folder import ────────────────────────────────────────────────────

  function handleFolderSelect(e) {
    const all = [...e.target.files]
    const files = all.filter(f => { const n = f.name.toLowerCase(); return n.endsWith('.xml') || n.endsWith('.mzml') })
    setImportFiles(files)
    setImportLog([])
    if (all.length > 0 && files.length === 0)
      setImportLog([`No .xml or .mzML files found (${all.length} other files ignored).`])
  }

  async function importFolder() {
    if (!datasetTitle.trim()) { setImportLog(['Please enter a dataset title.']); return }
    if (importFiles.length === 0) { setImportLog(['Please select a folder containing .xml (mzML) files.']); return }
    setImporting(true)
    setImportLog([])
    const log = (msg) => setImportLog(prev => [...prev, msg])
    const serverMs = { total: 0 }

    // ── build subjects ────────────────────────────────────────────────────
    // scheme is dump_only in SubjectRelationSchema so we encode category as a prefix
    const subjects = []
    datasetType.forEach(s => subjects.push({ subject: `edam::${s}` }))
    datasetSpecies.forEach(s => subjects.push({ subject: `ncbitaxon::${s}` }))
    datasetPTMs.forEach(s => subjects.push({ subject: `unimod::${s}` }))
    datasetKeywords.forEach(s => subjects.push({ subject: s }))

    // ── build contributors (PI) ───────────────────────────────────────────
    const contributors = []
    if (piName.trim()) {
      const nameParts = piName.trim().split(/\s+/)
      contributors.push({
        person_or_org: {
          type: 'personal',
          given_name: nameParts.slice(0, -1).join(' ') || nameParts[0],
          family_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
          name: piName.trim(),
          ...(piEmail.trim() ? { identifiers: [{ scheme: 'email', identifier: piEmail.trim() }] } : {}),
        },
        role: { id: 'ProjectLeader' },
        ...(piInstitution.trim() ? { affiliations: [{ name: piInstitution.trim(), ...(piCountry.trim() ? { id: piCountry.trim() } : {}) }] } : {}),
      })
    }

    // ── build descriptions ────────────────────────────────────────────────
    const additional_descriptions = []
    if (datasetDescription.trim())
      additional_descriptions.push({ description: datasetDescription.trim(), type: { id: 'abstract' } })

    log(`Creating dataset "${datasetTitle}"…`)
    const dsId = await createAndPublish('/api/dataset', {
      metadata: {
        ...rdmBase(),
        title: datasetTitle,
        ...(additional_descriptions.length ? { additional_descriptions } : {}),
        ...(subjects.length ? { subjects } : {}),
        ...(contributors.length ? { contributors } : {}),
      },
      files: { enabled: false },
    }, 'Dataset', log, serverMs)
    if (!dsId) { setImporting(false); return }

    for (const file of importFiles) {
      log(`\nProcessing ${file.name}…`)
      let parsed
      try {
        const xml = await file.text()
        parsed = parseMzML(xml)
      } catch (err) {
        log(`  ✗ Parse error: ${err.message}`)
        continue
      }

      const { msrun: msrunMeta, spectra } = parsed
      log(`  Parsed: ${spectra.length} spectra, ${msrunMeta.chromatogram_list?.length ?? 0} chromatograms`)

      // ── DreaMS embeddings ─────────────────────────────────────────────────
      log(`  Computing DreaMS embeddings…`)
      let embeddingsByScan = {}
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/dreams/embeddings', { method: 'POST', body: formData })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        embeddingsByScan = json.by_scan ?? {}
        log(`  Embeddings: ${Object.keys(embeddingsByScan).length} MS2 spectra embedded`)
      } catch (err) {
        log(`  ⚠ DreaMS unavailable (${err.message}), skipping embeddings`)
      }

      log(`  Creating MSRun…`)
      const msrunTitle = `${datasetTitle} – ${file.name}`
      const msrunId = await createAndPublish('/api/msrun', {
        metadata: { ...rdmBase(), title: msrunTitle, dataset: { id: dsId }, ...msrunMeta },
        files: { enabled: false },
      }, 'MSRun', log, serverMs)
      if (!msrunId) continue

      log(`  Creating ${spectra.length} spectrum records…`)
      let ok = 0, fail = 0
      for (const sp of spectra) {
        // extract scan number from native_id (e.g. "scan=19" → "19")
        const scanMatch = sp.native_id?.match(/scan=(\d+)/)
        const embedding = scanMatch ? embeddingsByScan[scanMatch[1]] : undefined

        const spId = await createAndPublish('/api/spectrum', {
          metadata: {
            ...rdmBase(),
            title: `${file.name} – ${sp.native_id}`,
            ...(embedding ? { dreams_embedding: embedding } : {}),
            dataset: { id: dsId },
            msrun: { id: msrunId },
            ...sp,
          },
          files: { enabled: false },
        }, `Spectrum ${sp.native_id}`, () => {}, serverMs)
        spId ? ok++ : fail++
      }
      log(`  Spectra: ${ok} published, ${fail} failed`)
    }

    const s = (serverMs.total / 1000).toFixed(1)
    log(`\nImport complete. Time spent on Invenio server: ${s}s`)
    setImporting(false)
  }

  // ── spectra search ────────────────────────────────────────────────────────

  const SPECTRA_PAGE_SIZE = 20

  // Maps frontend sort column + direction to Invenio sort option name
  const SORT_OPTIONS = {
    scanId:    { asc: 'native_id',    desc: 'native_id_desc' },
    precMz:    { asc: 'precmz',       desc: 'precmz_desc' },
    charge:    { asc: 'charge',       desc: 'charge_desc' },
  }

  async function searchSpectra(page = 0, overrideSort) {
    setSearching(true); setSearchError('')
    if (page === 0) setSearchResults(null)

    const minMz = parseFloat(precursorMzMin)
    const maxMz = parseFloat(precursorMzMax)
    if (precursorMzMin !== '' && isNaN(minMz)) {
      setSearchError('Precursor m/z min must be a number'); setSearching(false); return
    }
    if (precursorMzMax !== '' && isNaN(maxMz)) {
      setSearchError('Precursor m/z max must be a number'); setSearching(false); return
    }

    const clauses = []
    if (precursorMzMin !== '' || precursorMzMax !== '') {
      const lo = precursorMzMin !== '' ? minMz : '*'
      const hi = precursorMzMax !== '' ? maxMz : '*'
      clauses.push(`metadata.precursor_list.selected_ions.selected_ion_mz:[${lo} TO ${hi}]`)
    }
    if (formula.trim() !== '')
      clauses.push(`metadata.spectrum_cv_params.value:"${formula.trim()}"`)
    if (organism.trim() !== '')
      clauses.push(`metadata.msrun.metadata.samples.cv_params.value:"${organism.trim()}"`)

    const q = clauses.length > 0 ? clauses.join(' AND ') : '*'
    const params = new URLSearchParams({ q, size: SPECTRA_PAGE_SIZE, page: page + 1 })
    const effectiveCol = overrideSort?.col ?? sortCol
    const effectiveDir = overrideSort?.dir ?? sortDir
    const sortOption = effectiveCol && SORT_OPTIONS[effectiveCol]?.[effectiveDir]
    if (sortOption) params.set('sort', sortOption)
    const url = `/api/spectrum?${params}`

    const { ok, json } = await apiFetch(url)
    if (!ok) { setSearchError(json.message || `Search failed (${json.status ?? 'unknown'})`); setSearching(false); return }

    const msrunIds = [...new Set(
      (json.hits?.hits ?? []).map(h => h.metadata?.msrun?.id).filter(Boolean)
    )]
    const msrunMap = {}
    await Promise.all(msrunIds.map(async id => {
      const { ok: mok, json: mj } = await apiFetch(`/api/msrun/${id}`)
      if (mok) msrunMap[id] = mj
    }))

    setSpectraPage(page)
    setSearchResults({ ...json, msrunMap })
    setSearching(false)
  }

  // ── similarity search ─────────────────────────────────────────────────────

  async function searchSimilar(vector) {
    setSearchError('')
    const { ok, json } = await apiFetch('/api/spectrum/records/search-similar', {
      method: 'POST',
      body: JSON.stringify({ vector, k: 10 }),
    })
    if (!ok) { setSearchError(json?.message || 'Similarity search failed'); return }

    const msrunIds = [...new Set(
      (json.hits?.hits ?? []).map(h => h.metadata?.msrun?.id).filter(Boolean)
    )]
    const msrunMap = {}
    await Promise.all(msrunIds.map(async id => {
      const { ok: mok, json: mj } = await apiFetch(`/api/msrun/${id}`)
      if (mok) msrunMap[id] = mj
    }))

    setSearchResults({ ...json, msrunMap })
    setSpectrumPage(null)
  }

  // ── mzML file similarity search ───────────────────────────────────────────

  function buildFilterQuery() {
    const clauses = []
    const minMz = parseFloat(precursorMzMin)
    const maxMz = parseFloat(precursorMzMax)
    if (precursorMzMin !== '' || precursorMzMax !== '') {
      const lo = precursorMzMin !== '' && !isNaN(minMz) ? minMz : '*'
      const hi = precursorMzMax !== '' && !isNaN(maxMz) ? maxMz : '*'
      clauses.push(`metadata.precursor_list.selected_ions.selected_ion_mz:[${lo} TO ${hi}]`)
    }
    if (formula.trim() !== '')
      clauses.push(`metadata.spectrum_cv_params.value:"${formula.trim()}"`)
    if (organism.trim() !== '')
      clauses.push(`metadata.msrun.metadata.samples.cv_params.value:"${organism.trim()}"`)
    return clauses.length > 0 ? clauses.join(' AND ') : '*'
  }

  async function runMzFileSearch() {
    if (!mzFile) { setMzSearchError('Please select an mzML file.'); return }
    setMzSearching(true)
    setMzSearchError('')
    setMzSearchResults(null)
    setMzSearchProgress('Parsing mzML…')

    // 1. Parse
    let localSpectra, mzMsrun
    try {
      const xml = await mzFile.text()
      const parsed = parseMzML(xml)
      localSpectra = parsed.spectra
      mzMsrun = parsed.msrun
    } catch (err) {
      setMzSearchError(`Parse error: ${err.message}`)
      setMzSearching(false); setMzSearchProgress(''); return
    }
    setMzSearchProgress(`Parsed ${localSpectra.length} spectra. Computing DreaMS embeddings…`)

    // 2. Compute embeddings via DreaMS
    let embeddingsByScan = {}
    try {
      const fd = new FormData()
      fd.append('file', mzFile)
      const res = await fetch('/dreams/embeddings', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      embeddingsByScan = json.by_scan ?? {}
    } catch (err) {
      setMzSearchError(`DreaMS embedding failed: ${err.message}`)
      setMzSearching(false); setMzSearchProgress(''); return
    }

    // Attach embeddings to local spectra
    const spectraWithEmb = localSpectra.map(sp => {
      const scanMatch = sp.native_id?.match(/scan=(\d+)/)
      const embedding = scanMatch ? embeddingsByScan[scanMatch[1]] : undefined
      return { ...sp, embedding }
    }).filter(sp => sp.embedding)

    if (spectraWithEmb.length === 0) {
      setMzSearchError('No MS2 spectra with embeddings found in the file.')
      setMzSearching(false); setMzSearchProgress(''); return
    }

    setMzSearchProgress(`${spectraWithEmb.length} spectra embedded. Running similarity search…`)

    // 3. Build filter query for the repo
    const q = buildFilterQuery()

    // 4. For each local spectrum run similarity search scoped to the filter
    const rows = []
    for (let i = 0; i < spectraWithEmb.length; i++) {
      const sp = spectraWithEmb[i]
      setMzSearchProgress(`Searching ${i + 1} / ${spectraWithEmb.length}…`)

      const simParams = new URLSearchParams({ q })
      const { ok, json } = await apiFetch(`/api/spectrum/records/search-similar?${simParams}`, {
        method: 'POST',
        body: JSON.stringify({ vector: sp.embedding, k: 5 }),
      })
      if (!ok) continue

      const hits = json.hits?.hits ?? []
      if (hits.length === 0) continue

      const cvVal = (params, acc) => params?.find(p => p.accession === acc)?.value
      const localMeta = {
        scanId:   sp.native_id ?? '',
        precMz:   sp.precursor_list?.[0]?.selected_ions?.[0]?.selected_ion_mz ?? null,
        charge:   sp.precursor_list?.[0]?.selected_ions?.[0]?.charge_state ?? '',
        polarity: sp.scan_polarity?.id === 'MS:1000130' ? 'pos'
                : sp.scan_polarity?.id === 'MS:1000129' ? 'neg' : '',
        msLevel:  cvVal(sp.spectrum_cv_params, 'MS:1000511') ?? '',
        rt:       cvVal(sp.scan_list?.scans?.[0]?.cv_params, 'MS:1000016') ?? '',
        peaks:    sp.default_array_length ?? '',
      }
      rows.push({ local: localMeta, localSpec: sp, mzMsrun, matches: hits })
    }

    // 5. Sort rows: best similarity first (rank 0 = top repo hit)
    // Hits already come sorted by score from OpenSearch; rows are sorted by
    // how many matches they got (most matches = highest confidence).
    rows.sort((a, b) => b.matches.length - a.matches.length)

    // Collect all msrun IDs from all matches to fetch metadata in one pass
    const msrunIds = [...new Set(
      rows.flatMap(r => r.matches.map(h => h.metadata?.msrun?.id).filter(Boolean))
    )]
    const msrunMap = {}
    await Promise.all(msrunIds.map(async id => {
      const { ok: mok, json: mj } = await apiFetch(`/api/msrun/${id}`)
      if (mok) msrunMap[id] = mj
    }))

    setMzSearchResults({ rows, msrunMap })
    setMzSearchProgress('')
    setMzSearching(false)
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* ── top navbar ── */}
      <header className="navbar">
        <span className="navbar-title">Spectrum Admin</span>
        <div className="navbar-auth">
          {user ? (
            <div className="user-menu">
              <span className="navbar-user">{user.email}</span>
              <span className="role-badge">admin</span>
              <button onClick={handleLogout} className="btn-secondary btn-sm">Log out</button>
            </div>
          ) : (
            <button className="btn-primary btn-sm" onClick={() => setShowLoginModal(true)}>
              Log in
            </button>
          )}
        </div>
      </header>

      {/* ── login modal ── */}
      {showLoginModal && (
        <div className="modal-backdrop" onClick={() => { setShowLoginModal(false); setLoginError('') }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Log in</h2>
            <form onSubmit={handleLogin}>
              <div className="form-field">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-wide" required autoFocus />
              </div>
              <div className="form-field">
                <label>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-wide" required />
              </div>
              {loginError && <p className="error">{loginError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowLoginModal(false); setLoginError('') }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loggingIn}>
                  {loggingIn ? 'Logging in…' : 'Log in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── tabs ── */}
      <div className="tabs">
        <button
          className={`tab${activeTab === 'search' ? ' tab-active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Search
        </button>
        <button
          className={`tab${activeTab === 'import' ? ' tab-active' : ''}${!user ? ' tab-locked' : ''}`}
          onClick={() => user ? setActiveTab('import') : setShowLoginModal(true)}
          title={!user ? 'Log in to access dataset import' : undefined}
        >
          Import Dataset
          {!user && <span className="lock-icon">🔒</span>}
        </button>
      </div>

      {/* ── search tab ── */}
      {activeTab === 'search' && localSpectrumPage && (
        <SpectrumDetail
          m={localSpectrumPage.spec}
          msrunMeta={localSpectrumPage.msrun}
          onBack={() => setLocalSpectrumPage(null)}
        />
      )}
      {activeTab === 'search' && !localSpectrumPage && spectrumPage && (
        <SpectrumPage
          spectrumId={spectrumPage}
          onBack={() => setSpectrumPage(null)}
          onSimilaritySearch={searchSimilar}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !localSpectrumPage && !spectrumPage && msrunPage && (
        <MsrunPage
          msrunId={msrunPage}
          onBack={() => setMsrunPage(null)}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !localSpectrumPage && !spectrumPage && !msrunPage && datasetPage && (
        <DatasetPage
          datasetId={datasetPage}
          onBack={() => setDatasetPage(null)}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !localSpectrumPage && !spectrumPage && !msrunPage && !datasetPage && (
        <section className="card">
          <h2>Search Spectra</h2>

          <div className="search-filters">
            <div className="filter-group">
              <span className="filter-label">Precursor m/z</span>
              <div className="filter-range">
                <label>
                  Min
                  <input
                    type="number"
                    value={precursorMzMin}
                    onChange={e => setPrecursorMzMin(e.target.value)}
                    className="input-mz"
                    placeholder="e.g. 100"
                    step="any"
                  />
                </label>
                <span className="range-dash">–</span>
                <label>
                  Max
                  <input
                    type="number"
                    value={precursorMzMax}
                    onChange={e => setPrecursorMzMax(e.target.value)}
                    className="input-mz"
                    placeholder="e.g. 500"
                    step="any"
                  />
                </label>
              </div>
            </div>

            <div className="filter-group">
              <label className="filter-label" htmlFor="formula-input">Molecular formula</label>
              <input
                id="formula-input"
                type="text"
                value={formula}
                onChange={e => setFormula(e.target.value)}
                className="input-wide"
                placeholder="e.g. C8H10N4O2"
              />
            </div>

            <div className="filter-group">
              <label className="filter-label" htmlFor="organism-input">Organism</label>
              <input
                id="organism-input"
                type="text"
                value={organism}
                onChange={e => setOrganism(e.target.value)}
                className="input-wide"
                placeholder="e.g. Homo sapiens"
              />
            </div>

            <div className="filter-group">
              <label className="filter-label">mzML file (similarity search)</label>
              <div className="mz-file-row">
                <input
                  ref={mzFileInputRef}
                  type="file"
                  accept=".mzml,.xml"
                  style={{ display: 'none' }}
                  onChange={e => { setMzFile(e.target.files?.[0] ?? null); setMzSearchResults(null); setMzSearchError('') }}
                />
                <button className="btn-secondary btn-sm" onClick={() => mzFileInputRef.current.click()} disabled={mzSearching}>
                  Choose file…
                </button>
                <span className="mz-file-name">{mzFile ? mzFile.name : 'No file selected'}</span>
                {mzFile && (
                  <button className="btn-secondary btn-sm" onClick={() => { setMzFile(null); setMzSearchResults(null); setMzSearchError(''); mzFileInputRef.current.value = '' }} disabled={mzSearching}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="search-actions">
            <button onClick={() => searchSpectra(0)} disabled={searching} className="btn-primary search-btn">
              {searching ? 'Searching…' : 'Search Repo'}
            </button>
            {mzFile && (
              <button onClick={runMzFileSearch} disabled={mzSearching || searching} className="btn-primary search-btn">
                {mzSearching ? (mzSearchProgress || 'Searching…') : 'Search by mzML File'}
              </button>
            )}
          </div>

          {searchError && <p className="error">{searchError}</p>}
          {mzSearchError && <p className="error">{mzSearchError}</p>}

          {searchResults && (() => {
            const rows = (searchResults.hits?.hits ?? []).map(hit => {
              const m = hit.metadata ?? {}
              const msrun = searchResults.msrunMap?.[m.msrun?.id]
              return {
                hit,
                scanId:      m.native_id ?? '',
                precMz:      m.precursor_list?.[0]?.selected_ions?.[0]?.selected_ion_mz ?? null,
                charge:      m.precursor_list?.[0]?.selected_ions?.[0]?.charge_state ?? '',
                polarity:    m.scan_polarity?.id === 'MS:1000130' ? 'pos' : m.scan_polarity?.id === 'MS:1000129' ? 'neg' : '',
                msLevel:     m.spectrum_cv_params?.find(p => p.accession === 'MS:1000511')?.value ?? '',
                fragMethod:  m.precursor_list?.[0]?.activation?.dissociation_method?.title?.en
                               ?? m.precursor_list?.[0]?.activation?.dissociation_method?.id ?? '',
                instrument:  (() => {
                  const ic = msrun?.metadata?.instrument_configurations?.[0]
                  if (!ic) return ''
                  if (ic.instrument_model?.name) return ic.instrument_model.name
                  const analyzers = ic.analyzers?.map(a => a.mass_analyzer_type?.name).filter(Boolean)
                  return analyzers?.length ? analyzers.join(' / ') : ''
                })(),
                runId:          msrun?.metadata?.run_id ?? '',
                msrunRecordId:  m.msrun?.id ?? null,
                dataset:        msrun?.metadata?.dataset?.metadata?.title ?? '',
                datasetRecordId: msrun?.metadata?.dataset?.id ?? null,
                sourceId:       hit.id,
              }
            })

            const total = searchResults.hits?.total?.value ?? searchResults.hits?.total ?? 0
            const totalPages = Math.ceil(total / SPECTRA_PAGE_SIZE)

            function SortTh({ col, children, className }) {
              const active = sortCol === col
              const sortable = col in SORT_OPTIONS
              const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
              if (!sortable) return <th className={className ?? ''}>{children}</th>
              return (
                <th
                  className={`sortable${active ? ' sort-active' : ''}${className ? ' ' + className : ''}`}
                  onClick={() => {
                    const newDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc'
                    setSortCol(col); setSortDir(newDir)
                    searchSpectra(0, { col, dir: newDir })
                  }}
                >{children}{indicator}</th>
              )
            }

            return (
              <div className="results">
                <p className="results-count">
                  <strong>{total}</strong> spectra found
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortTh col="scanId" className="col-name">Scan ID</SortTh>
                      <SortTh col="precMz">Precursor m/z</SortTh>
                      <SortTh col="charge">Charge</SortTh>
                      <SortTh col="polarity">Mode</SortTh>
                      <SortTh col="msLevel">MS level</SortTh>
                      <SortTh col="fragMethod">Fragmentation</SortTh>
                      <SortTh col="instrument">Instrument</SortTh>
                      <SortTh col="runId">Run ID</SortTh>
                      <SortTh col="dataset">Dataset</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length > 0
                      ? rows.map((r, idx) => (
                          <tr key={r.hit.id}>
                            <td>{spectraPage * SPECTRA_PAGE_SIZE + idx + 1}</td>
                            <td className="col-name" title={r.scanId}>
                              <button className="link-btn" onClick={() => setSpectrumPage(r.sourceId)}>
                                {(r.scanId?.match(/scan=(\d+)/)?.[1] ?? r.scanId) || r.sourceId}
                              </button>
                            </td>
                            <td>{r.precMz != null ? r.precMz.toFixed(4) : '—'}</td>
                            <td>{r.charge !== '' ? r.charge : '—'}</td>
                            <td><span className={`polarity-badge polarity-${r.polarity || '-'}`}>{r.polarity || '—'}</span></td>
                            <td>{r.msLevel || '—'}</td>
                            <td>{r.fragMethod || '—'}</td>
                            <td>{r.instrument || '—'}</td>
                            <td>
                              {r.msrunRecordId
                                ? <button className="link-btn" onClick={() => setMsrunPage(r.msrunRecordId)}>
                                    <code className="cv-id">{r.runId || r.msrunRecordId}</code>
                                  </button>
                                : <code className="cv-id">{r.runId || '—'}</code>
                              }
                            </td>
                            <td>
                              {r.datasetRecordId
                                ? <button className="link-btn" onClick={() => setDatasetPage(r.datasetRecordId)}>
                                    {r.dataset || r.datasetRecordId}
                                  </button>
                                : (r.dataset || '—')
                              }
                            </td>
                          </tr>
                        ))
                      : (
                        <tr>
                          <td colSpan={10} className="no-results">No spectra matched the filters.</td>
                        </tr>
                      )
                    }
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="pagination">
                    <button className="btn-secondary" onClick={() => searchSpectra(0)} disabled={spectraPage === 0 || searching}>«</button>
                    <button className="btn-secondary" onClick={() => searchSpectra(spectraPage - 1)} disabled={spectraPage === 0 || searching}>‹</button>
                    <span>Page {spectraPage + 1} of {totalPages}</span>
                    <button className="btn-secondary" onClick={() => searchSpectra(spectraPage + 1)} disabled={spectraPage >= totalPages - 1 || searching}>›</button>
                    <button className="btn-secondary" onClick={() => searchSpectra(totalPages - 1)} disabled={spectraPage >= totalPages - 1 || searching}>»</button>
                  </div>
                )}
              </div>
            )
          })()}

          {mzSearchResults && (() => {
            const { rows, msrunMap } = mzSearchResults
            if (rows.length === 0) return (
              <p className="hint" style={{ marginTop: '1rem' }}>No matches found for any spectrum in the file.</p>
            )
            return (
              <div className="results mz-results" style={{ marginTop: '1.5rem' }}>
                <p className="results-count">
                  <strong>{rows.length}</strong> spectra matched (sorted by best similarity)
                </p>
                <div className="mz-results-table-wrap">
                  <table className="mz-results-table">
                    <thead>
                      <tr>
                        <th colSpan={6} className="mz-col-group mz-col-group-local">Local mzML spectrum</th>
                        <th colSpan={5} className="mz-col-group mz-col-group-repo">Best match in repository</th>
                      </tr>
                      <tr>
                        <th>#</th>
                        <th>Scan ID</th>
                        <th>Prec. m/z</th>
                        <th>Charge</th>
                        <th>Mode</th>
                        <th>RT (min)</th>
                        <th>Rank</th>
                        <th>Scan ID</th>
                        <th>Prec. m/z</th>
                        <th>Dataset</th>
                        <th>Run ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIdx) => {
                        const { local, localSpec, mzMsrun: rowMzMsrun, matches } = row
                        return matches.map((hit, hitIdx) => {
                          const m = hit.metadata ?? {}
                          const msrun = msrunMap?.[m.msrun?.id]
                          const repoScanId = m.native_id ?? hit.id
                          const repoPrecMz = m.precursor_list?.[0]?.selected_ions?.[0]?.selected_ion_mz
                          const repoDataset = msrun?.metadata?.dataset?.metadata?.title ?? msrun?.metadata?.dataset?.id ?? ''
                          const repoRunId = msrun?.metadata?.run_id ?? ''
                          const msrunRecordId = m.msrun?.id ?? null
                          const datasetRecordId = msrun?.metadata?.dataset?.id ?? null

                          return (
                            <tr key={`${rowIdx}-${hitIdx}`} className={hitIdx === 0 ? 'mz-row-best' : 'mz-row-alt'}>
                              {hitIdx === 0 && <>
                                <td rowSpan={matches.length} className="mz-local-cell mz-seq">{rowIdx + 1}</td>
                                <td rowSpan={matches.length} className="mz-local-cell col-name" title={local.scanId}>
                                  <button className="link-btn" onClick={() => setLocalSpectrumPage({ spec: localSpec, msrun: rowMzMsrun })}>
                                    {local.scanId?.match(/scan=(\d+)/)?.[1] ?? local.scanId}
                                  </button>
                                </td>
                                <td rowSpan={matches.length} className="mz-local-cell">
                                  {local.precMz != null ? local.precMz.toFixed(4) : '—'}
                                </td>
                                <td rowSpan={matches.length} className="mz-local-cell">{local.charge || '—'}</td>
                                <td rowSpan={matches.length} className="mz-local-cell">
                                  <span className={`polarity-badge polarity-${local.polarity || '-'}`}>{local.polarity || '—'}</span>
                                </td>
                                <td rowSpan={matches.length} className="mz-local-cell">
                                  {local.rt ? parseFloat(local.rt).toFixed(3) : '—'}
                                </td>
                              </>}
                              <td className="mz-rank-cell">{hitIdx + 1}</td>
                              <td>
                                <button className="link-btn" onClick={() => setSpectrumPage(hit.id)}>
                                  {repoScanId?.match(/scan=(\d+)/)?.[1] ?? repoScanId}
                                </button>
                              </td>
                              <td>{repoPrecMz != null ? repoPrecMz.toFixed(4) : '—'}</td>
                              <td>
                                {datasetRecordId
                                  ? <button className="link-btn" onClick={() => setDatasetPage(datasetRecordId)}>{repoDataset || datasetRecordId}</button>
                                  : (repoDataset || '—')}
                              </td>
                              <td>
                                {msrunRecordId
                                  ? <button className="link-btn" onClick={() => setMsrunPage(msrunRecordId)}><code className="cv-id">{repoRunId || msrunRecordId}</code></button>
                                  : <code className="cv-id">{repoRunId || '—'}</code>}
                              </td>
                            </tr>
                          )
                        })
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </section>
      )}

      {/* ── import tab (authenticated only) ── */}
      {activeTab === 'import' && user && (
        <>
          <section className="card">
            <h2>Import mzML Folder</h2>
            <p className="hint">
              Select a folder of <code>.xml</code> (mzML) files. One Dataset is created, then one MSRun
              + its Spectrum records are created per file.
            </p>

            <h3 className="sp-section" style={{ marginTop: '0.5rem' }}>Dataset</h3>

            <div className="form-field">
              <label>Title <span className="required">*</span></label>
              <input
                type="text"
                value={datasetTitle}
                onChange={e => setDatasetTitle(e.target.value)}
                className="input-wide"
                placeholder="e.g. My LC-MS experiment 2024"
                disabled={importing}
              />
            </div>

            <div className="form-field">
              <label>Description</label>
              <textarea
                value={datasetDescription}
                onChange={e => setDatasetDescription(e.target.value)}
                className="input-wide"
                rows={3}
                placeholder="Free-text abstract describing this dataset."
                disabled={importing}
              />
            </div>

            <div className="form-field">
              <label>Dataset type</label>
              <TagInput
                values={datasetType}
                onChange={setDatasetType}
                suggestions={DATASET_TYPE_SUGGESTIONS}
                placeholder="Type or choose dataset type…"
                disabled={importing}
                listId="dataset-type-list"
                maxItems={1}
              />
            </div>

            <div className="form-field">
              <label>Species</label>
              <TagInput
                values={datasetSpecies}
                onChange={setDatasetSpecies}
                suggestions={SPECIES_SUGGESTIONS}
                placeholder="Type or choose species…"
                disabled={importing}
                listId="species-list"
              />
            </div>

            <div className="form-field">
              <label>Post-Translational Modifications</label>
              <TagInput
                values={datasetPTMs}
                onChange={setDatasetPTMs}
                suggestions={PTM_SUGGESTIONS}
                placeholder="Type or choose PTM…"
                disabled={importing}
                listId="ptm-list"
              />
            </div>

            <div className="form-field">
              <label>Keywords</label>
              <TagInput
                values={datasetKeywords}
                onChange={setDatasetKeywords}
                placeholder="Type keyword and press Enter…"
                disabled={importing}
                listId="keyword-list"
              />
            </div>

            <h3 className="sp-section">Principal Investigator</h3>

            <div className="form-row">
              <div className="form-field">
                <label>Name</label>
                <input
                  type="text"
                  value={piName}
                  onChange={e => setPiName(e.target.value)}
                  className="input-wide"
                  placeholder="e.g. Jane Smith"
                  disabled={importing}
                />
              </div>
              <div className="form-field">
                <label>Email</label>
                <input
                  type="email"
                  value={piEmail}
                  onChange={e => setPiEmail(e.target.value)}
                  className="input-wide"
                  placeholder="e.g. jane.smith@university.edu"
                  disabled={importing}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Institution</label>
                <input
                  type="text"
                  value={piInstitution}
                  onChange={e => setPiInstitution(e.target.value)}
                  className="input-wide"
                  placeholder="e.g. Czech Academy of Sciences"
                  disabled={importing}
                />
              </div>
              <div className="form-field">
                <label>Country</label>
                <input
                  type="text"
                  value={piCountry}
                  onChange={e => setPiCountry(e.target.value)}
                  className="input-wide"
                  placeholder="ISO 3166 code, e.g. CZ"
                  maxLength={2}
                  disabled={importing}
                />
              </div>
            </div>

            <h3 className="sp-section">mzML Files</h3>

            <div className="form-field">
              <div className="row" style={{ marginBottom: 0 }}>
                <input
                  ref={folderInputRef}
                  type="file"
                  webkitdirectory=""
                  directory=""
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFolderSelect}
                />
                <button className="btn-secondary" onClick={() => folderInputRef.current.click()} disabled={importing}>
                  Choose folder…
                </button>
                <span style={{ fontSize: '0.85rem', color: '#888', alignSelf: 'center' }}>
                  {importFiles.length > 0
                    ? `${importFiles.length} .xml file${importFiles.length > 1 ? 's' : ''} selected`
                    : 'No folder selected'}
                </span>
              </div>
            </div>

            {importFiles.length > 0 && (
              <ul className="file-list">
                {importFiles.map(f => <li key={f.name}>{f.name} <span className="file-size">({(f.size / 1024).toFixed(1)} KB)</span></li>)}
              </ul>
            )}

            <button
              onClick={importFolder}
              disabled={importing || importFiles.length === 0}
              className="btn-primary"
              style={{ marginTop: '0.8rem' }}
            >
              {importing ? 'Importing…' : 'Create Dataset & Import Runs'}
            </button>

            {importLog.length > 0 && <pre className="log">{importLog.join('\n')}</pre>}
          </section>

        </>
      )}
    </div>
  )
}

export default App
