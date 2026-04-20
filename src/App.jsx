import { useState, useRef } from 'react'
import './App.css'

// ── mzML XML → JSON transformer ───────────────────────────────────────────────

function attr(el, name, fallback = undefined) {
  const v = el?.getAttribute(name)
  return v != null ? v : fallback
}

function parseCvParams(el) {
  if (!el) return []
  return [...el.querySelectorAll(':scope > cvParam')].map(p => ({
    accession: attr(p, 'accession'),
    name: attr(p, 'name'),
    ...(attr(p, 'value') != null && attr(p, 'value') !== '' ? { value: attr(p, 'value') } : {}),
    ...(attr(p, 'unitAccession') ? { unit_accession: attr(p, 'unitAccession'), unit_name: attr(p, 'unitName') } : {}),
  }))
}

function parseBinaryDataArrayList(spectrumEl) {
  return [...spectrumEl.querySelectorAll(':scope > binaryDataArrayList > binaryDataArray')].map(bda => {
    const cvs = parseCvParams(bda)
    const arrayType      = cvs.find(c => ['MS:1000514','MS:1000515','MS:1000595','MS:1000516'].includes(c.accession))
    const binaryDataType = cvs.find(c => ['MS:1000521','MS:1000523'].includes(c.accession))
    const compressionType= cvs.find(c => ['MS:1000574','MS:1000576'].includes(c.accession))
    const additional     = cvs.filter(c => c !== arrayType && c !== binaryDataType && c !== compressionType)
    return {
      ...(attr(bda, 'arrayLength') ? { array_length: parseInt(attr(bda, 'arrayLength')) } : {}),
      ...(attr(bda, 'dataProcessingRef') ? { data_processing_ref: attr(bda, 'dataProcessingRef') } : {}),
      encoded_length: parseInt(attr(bda, 'encodedLength', '0')),
      ...(arrayType       ? { array_type: arrayType }             : {}),
      ...(binaryDataType  ? { binary_data_type: binaryDataType }  : {}),
      ...(compressionType ? { compression_type: compressionType } : {}),
      ...(additional.length ? { additional_cv_params: additional } : {}),
      binary: bda.querySelector('binary')?.textContent?.trim() ?? '',
    }
  })
}

function parseMzML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const root = doc.querySelector('mzML') ?? doc.querySelector('indexedmzML > mzML')
  if (!root) throw new Error('No <mzML> element found')

  // ── MSRun-level metadata ────────────────────────────────────────────────────

  const cvList = [...root.querySelectorAll(':scope > cvList > cv')].map(cv => ({
    cv_ref: attr(cv, 'id'), full_name: attr(cv, 'fullName'),
    version: attr(cv, 'version'), uri: attr(cv, 'URI'),
  }))

  const fileDesc = root.querySelector(':scope > fileDescription')
  const file_content = parseCvParams(fileDesc?.querySelector('fileContent'))
  const source_files = [...(fileDesc?.querySelectorAll('sourceFileList > sourceFile') ?? [])].map(sf => {
    const cvs = parseCvParams(sf)
    const file_format    = cvs.find(c => c.accession?.startsWith('MS:10005'))
    const checksum_type  = cvs.find(c => ['MS:1000568','MS:1000569'].includes(c.accession))
    const native_id_format = cvs.find(c => c.accession && !['MS:1000568','MS:1000569'].includes(c.accession) && c !== file_format)
    const checksum_value = checksum_type ? cvs.find(c => c === checksum_type)?.value : undefined
    return {
      source_file_id: attr(sf, 'id'), name: attr(sf, 'name'), location: attr(sf, 'location'),
      ...(file_format ? { file_format: { id: file_format.accession } } : {}),
      ...(checksum_type ? { checksum_type: { accession: checksum_type.accession, name: checksum_type.name } } : {}),
      ...(checksum_value ? { checksum_value } : {}),
      ...(native_id_format ? { native_id_format: { accession: native_id_format.accession, name: native_id_format.name } } : {}),
    }
  })
  const contacts = [...(fileDesc?.querySelectorAll('contact') ?? [])].map(c => {
    const cvs = parseCvParams(c)
    const get = (acc) => cvs.find(p => p.accession === acc)?.value
    return {
      ...(get('MS:1000586') ? { name: get('MS:1000586') } : {}),
      ...(get('MS:1000590') ? { affiliation: get('MS:1000590') } : {}),
      ...(get('MS:1000587') ? { address: get('MS:1000587') } : {}),
      ...(get('MS:1000589') ? { url: get('MS:1000589') } : {}),
      ...(get('MS:1000588') ? { email: get('MS:1000588') } : {}),
    }
  })

  const referenceable_param_groups = [...root.querySelectorAll(':scope > referenceableParamGroupList > referenceableParamGroup')].map(g => ({
    group_id: attr(g, 'id'),
    cv_params: parseCvParams(g),
  }))

  const samples = [...root.querySelectorAll(':scope > sampleList > sample')].map(s => ({
    sample_id: attr(s, 'id'),
    ...(attr(s, 'name') ? { name: attr(s, 'name') } : {}),
    cv_params: parseCvParams(s),
  }))

  const software_list = [...root.querySelectorAll(':scope > softwareList > software')].map(s => ({
    software_id: attr(s, 'id'),
    version: attr(s, 'version'),
    cv_params: parseCvParams(s),
  }))

  const scan_settings_list = [...root.querySelectorAll(':scope > scanSettingsList > scanSettings')].map(ss => ({
    scan_settings_id: attr(ss, 'id'),
    cv_params: parseCvParams(ss),
    source_file_refs: [...ss.querySelectorAll('sourceFileRef')].map(r => attr(r, 'ref')),
    targets: [...ss.querySelectorAll('target')].map(t => ({ cv_params: parseCvParams(t) })),
  }))

  const instrument_configurations = [...root.querySelectorAll(':scope > instrumentConfigurationList > instrumentConfiguration')].map(ic => {
    const cvs = parseCvParams(ic)
    const instrument_model = cvs.find(c => c.accession?.startsWith('MS:1000'))
    return {
      config_id: attr(ic, 'id'),
      ...(attr(ic, 'scanSettingsRef') ? { scan_settings_ref: attr(ic, 'scanSettingsRef') } : {}),
      ...(instrument_model ? { instrument_model } : {}),
      instrument_cv_params: cvs.filter(c => c !== instrument_model),
      sources: [...ic.querySelectorAll('componentList > source')].map(s => {
        const scvs = parseCvParams(s)
        const ionization = scvs.find(c => c.accession)
        return { order: parseInt(attr(s, 'order', '1')), ...(ionization ? { ionization_type: ionization } : {}), cv_params: scvs.filter(c => c !== ionization) }
      }),
      analyzers: [...ic.querySelectorAll('componentList > analyzer')].map(a => {
        const acvs = parseCvParams(a)
        const mass_analyzer = acvs.find(c => c.accession)
        return { order: parseInt(attr(a, 'order', '1')), ...(mass_analyzer ? { mass_analyzer_type: mass_analyzer } : {}), cv_params: acvs.filter(c => c !== mass_analyzer) }
      }),
      detectors: [...ic.querySelectorAll('componentList > detector')].map(d => {
        const dcvs = parseCvParams(d)
        const detector = dcvs.find(c => c.accession)
        return { order: parseInt(attr(d, 'order', '1')), ...(detector ? { detector_type: detector } : {}), cv_params: dcvs.filter(c => c !== detector) }
      }),
      ...(ic.querySelector('softwareRef') ? { software_ref: attr(ic.querySelector('softwareRef'), 'ref') } : {}),
    }
  })

  const data_processing_list = [...root.querySelectorAll(':scope > dataProcessingList > dataProcessing')].map(dp => ({
    processing_id: attr(dp, 'id'),
    processing_methods: [...dp.querySelectorAll('processingMethod')].map(pm => ({
      order: parseInt(attr(pm, 'order', '1')),
      ...(attr(pm, 'softwareRef') ? { software_ref: attr(pm, 'softwareRef') } : {}),
      cv_params: parseCvParams(pm),
    })),
  }))

  const runEl = root.querySelector(':scope > run')
  const run_id = attr(runEl, 'id')
  const start_time_stamp = attr(runEl, 'startTimeStamp')
  const spectrumListEl = runEl?.querySelector(':scope > spectrumList')
  const spectrum_count = parseInt(attr(spectrumListEl, 'count', '0'))
  const default_spectrum_data_processing_ref = attr(spectrumListEl, 'defaultDataProcessingRef')

  const chromatogram_list = [...(runEl?.querySelectorAll(':scope > chromatogramList > chromatogram') ?? [])].map(ch => {
    const cvs = parseCvParams(ch)
    const chromatogram_type = cvs.find(c => c.accession)
    const precEl = ch.querySelector(':scope > precursor')
    const prodEl = ch.querySelector(':scope > product')
    const parseIsoWin = (el) => {
      if (!el) return undefined
      const iwEl = el.querySelector('isolationWindow')
      if (!iwEl) return undefined
      const icvs = parseCvParams(iwEl)
      const target = icvs.find(c => c.accession === 'MS:1000827')
      return { isolation_window: {
        ...(target ? { target_mz: parseFloat(target.value) } : {}),
        cv_params: icvs.filter(c => c !== target),
      }}
    }
    return {
      chromatogram_id: attr(ch, 'id'),
      index: parseInt(attr(ch, 'index', '0')),
      default_array_length: parseInt(attr(ch, 'defaultArrayLength', '0')),
      ...(attr(ch, 'dataProcessingRef') ? { data_processing_ref: attr(ch, 'dataProcessingRef') } : {}),
      ...(chromatogram_type ? { chromatogram_type } : {}),
      cv_params: cvs.filter(c => c !== chromatogram_type),
      ...(precEl ? { precursor: parseIsoWin(precEl) } : {}),
      ...(prodEl ? { product: parseIsoWin(prodEl) } : {}),
      binary_data_array_list: parseBinaryDataArrayList(ch),
    }
  })

  // ── Spectra ─────────────────────────────────────────────────────────────────

  const spectra = [...(spectrumListEl?.querySelectorAll(':scope > spectrum') ?? [])].map(sp => {
    const cvs = parseCvParams(sp)
    const spectrum_type           = cvs.find(c => ['MS:1000579','MS:1000580'].includes(c.accession))
    const spectrum_representation = cvs.find(c => ['MS:1000127','MS:1000128'].includes(c.accession))
    const scan_polarity           = cvs.find(c => ['MS:1000130','MS:1000129'].includes(c.accession))
    const spectrum_cv_params      = cvs.filter(c => c !== spectrum_type && c !== spectrum_representation && c !== scan_polarity)

    const scanListEl = sp.querySelector(':scope > scanList')
    const scanListCvs = parseCvParams(scanListEl)
    const spectra_combination = scanListCvs.find(c => c.accession)
    const scans = [...(scanListEl?.querySelectorAll(':scope > scan') ?? [])].map(sc => {
      const scCvs = parseCvParams(sc)
      const swList = [...sc.querySelectorAll('scanWindow')].map(sw => {
        const swCvs = parseCvParams(sw)
        const lower = swCvs.find(c => c.accession === 'MS:1000501')
        const upper = swCvs.find(c => c.accession === 'MS:1000500')
        return {
          ...(lower ? { lower_limit: parseFloat(lower.value) } : {}),
          ...(upper ? { upper_limit: parseFloat(upper.value) } : {}),
          cv_params: swCvs.filter(c => c !== lower && c !== upper),
        }
      })
      return {
        ...(attr(sc, 'instrumentConfigurationRef') ? { instrument_configuration_ref: attr(sc, 'instrumentConfigurationRef') } : {}),
        cv_params: scCvs,
        ...(swList.length ? { scan_window_list: swList } : {}),
      }
    })

    const precursor_list = [...sp.querySelectorAll(':scope > precursorList > precursor')].map(pre => {
      const iwEl = pre.querySelector('isolationWindow')
      const iwCvs = parseCvParams(iwEl)
      const target = iwCvs.find(c => c.accession === 'MS:1000827')
      const lower  = iwCvs.find(c => c.accession === 'MS:1000828')
      const upper  = iwCvs.find(c => c.accession === 'MS:1000829')

      const selected_ions = [...pre.querySelectorAll('selectedIonList > selectedIon')].map(si => {
        const siCvs = parseCvParams(si)
        const mz     = siCvs.find(c => c.accession === 'MS:1000744')
        const charge = siCvs.find(c => c.accession === 'MS:1000041')
        const intens = siCvs.find(c => c.accession === 'MS:1000042')
        return {
          ...(mz     ? { selected_ion_mz: parseFloat(mz.value) }    : {}),
          ...(charge ? { charge_state: parseInt(charge.value) }      : {}),
          ...(intens ? { intensity: parseFloat(intens.value) }       : {}),
        }
      })

      const actEl = pre.querySelector('activation')
      const actCvs = parseCvParams(actEl)
      const dissoc = actCvs.find(c => c.accession)
      const energy = actCvs.find(c => c.accession === 'MS:1000045')

      return {
        ...(attr(pre, 'spectrumRef') ? { spectrum_ref: attr(pre, 'spectrumRef') } : {}),
        isolation_window: {
          ...(target ? { target_mz: parseFloat(target.value) }   : {}),
          ...(lower  ? { lower_offset: parseFloat(lower.value) } : {}),
          ...(upper  ? { upper_offset: parseFloat(upper.value) } : {}),
          cv_params: iwCvs.filter(c => c !== target && c !== lower && c !== upper),
        },
        selected_ions,
        activation: {
          ...(dissoc ? { dissociation_method: { id: dissoc.accession } } : {}),
          ...(energy ? { activation_energy: parseFloat(energy.value) }   : {}),
        },
      }
    })

    return {
      native_id: attr(sp, 'id'),
      ...(attr(sp, 'spotID') ? { spot_id: attr(sp, 'spotID') }                         : {}),
      index: parseInt(attr(sp, 'index', '0')),
      default_array_length: parseInt(attr(sp, 'defaultArrayLength', '0')),
      ...(attr(sp, 'dataProcessingRef') ? { data_processing_ref: attr(sp, 'dataProcessingRef') } : {}),
      ...(attr(sp, 'sourceFileRef')     ? { source_file_ref: attr(sp, 'sourceFileRef') }         : {}),
      ...(spectrum_type           ? { spectrum_type:           { id: spectrum_type.accession }           } : {}),
      ...(spectrum_representation ? { spectrum_representation: { id: spectrum_representation.accession } } : {}),
      ...(scan_polarity           ? { scan_polarity:           { id: scan_polarity.accession }           } : {}),
      spectrum_cv_params,
      scan_list: {
        ...(spectra_combination ? { spectra_combination: { id: spectra_combination.accession } } : {}),
        cv_params: scanListCvs.filter(c => c !== spectra_combination),
        scans,
      },
      ...(precursor_list.length ? { precursor_list } : {}),
      binary_data_array_list: parseBinaryDataArrayList(sp),
    }
  })

  const msrun = {
    mzml_accession: attr(root, 'accession'),
    mzml_version: attr(root, 'version'),
    mzml_id: attr(root, 'id'),
    cv_list: cvList,
    file_content,
    source_files,
    contacts,
    referenceable_param_groups,
    samples,
    software_list,
    scan_settings_list,
    instrument_configurations,
    data_processing_list,
    run_id,
    ...(attr(runEl, 'defaultInstrumentConfigurationRef') ? { default_instrument_configuration_ref: attr(runEl, 'defaultInstrumentConfigurationRef') } : {}),
    ...(attr(runEl, 'defaultSourceFileRef') ? { default_source_file_ref: attr(runEl, 'defaultSourceFileRef') } : {}),
    ...(attr(runEl, 'sampleRef') ? { sample_ref: attr(runEl, 'sampleRef') } : {}),
    ...(start_time_stamp ? { start_time_stamp } : {}),
    spectrum_count,
    ...(default_spectrum_data_processing_ref ? { default_spectrum_data_processing_ref } : {}),
    chromatogram_list,
  }

  return { msrun, spectra }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

function rdmBase() {
  return {
    publication_date: today(),
    creators: [{ person_or_org: { type: 'personal', family_name: 'Import', given_name: 'Auto' } }],
    resource_type: { id: 'c_ddb1' },
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  // ── auth state ────────────────────────────────────────────────────────────
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [token, setToken]         = useState('')
  const [user, setUser]           = useState(null)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  // ── record creation state ─────────────────────────────────────────────────
  const [creating, setCreating]         = useState(false)
  const [createLog, setCreateLog]       = useState([])
  const [creatingExample, setCreatingExample] = useState(false)
  const [exampleLog, setExampleLog]     = useState([])

  // ── mzML folder import state ──────────────────────────────────────────────
  const [importFiles, setImportFiles]   = useState([])   // File[]
  const [datasetTitle, setDatasetTitle] = useState('')
  const [importing, setImporting]       = useState(false)
  const [importLog, setImportLog]       = useState([])
  const folderInputRef = useRef(null)

  // ── similarity search state ───────────────────────────────────────────────
  const [vector, setVector]             = useState('0.1, 0.9')
  const [k, setK]                       = useState(5)
  const [searching, setSearching]       = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [searchError, setSearchError]   = useState('')

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

  async function createAndPublish(path, payload, label, log) {
    const draft = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
    if (!draft.ok) {
      log(`  ✗ ${label} draft failed: ${JSON.stringify(draft.json)}`)
      return null
    }
    const id = draft.json.id
    const pub = await apiFetch(`${path}/${id}/draft/actions/publish`, { method: 'POST' })
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
  }

  function handleLogout() {
    setUser(null); setToken(''); setEmail(''); setPassword('')
    setCreateLog([]); setExampleLog([]); setImportLog([]); setSearchResults(null)
  }

  // ── create 10 test records ────────────────────────────────────────────────

  async function createRecords() {
    setCreating(true); setCreateLog([])
    const log = (msg) => setCreateLog(prev => [...prev, msg])
    for (let i = 1; i <= 10; i++) {
      const x = randFloat(), y = randFloat()
      log(`Record ${i}: embedding [${x}, ${y}]`)
      const payload = {
        metadata: { ...rdmBase(), title: `Test spectrum ${i}`, embedding: [parseFloat(x), parseFloat(y)] },
        files: { enabled: false },
      }
      const id = await createAndPublish('/api/spectrum', payload, `Spectrum ${i}`, log)
      if (!id) continue
    }
    setCreating(false)
  }

  // ── create MS dataset example ─────────────────────────────────────────────

  async function createMSDatasetExample() {
    setCreatingExample(true); setExampleLog([])
    const log = (msg) => setExampleLog(prev => [...prev, msg])

    log('Creating dataset…')
    const dsId = await createAndPublish('/api/dataset', {
      metadata: { ...rdmBase(), title: 'tiny.pwiz.1.1 – demo mzML dataset' },
      files: { enabled: false },
    }, 'Dataset', log)
    if (!dsId) { setCreatingExample(false); return }

    log('Creating MSRun…')
    const msrunId = await createAndPublish('/api/msrun', {
      metadata: {
        ...rdmBase(),
        title: 'tiny.pwiz.1.1 – MSRun',
        dataset: { id: dsId },
        mzml_version: '1.1.0',
        mzml_id: 'urn:lsid:psidev.info:mzML.instanceDocuments.tiny.pwiz',
        run_id: 'Experiment_x0020_1',
        spectrum_count: 4,
      },
      files: { enabled: false },
    }, 'MSRun', log)
    if (!msrunId) { setCreatingExample(false); return }

    log('Creating spectrum (scan=19)…')
    await createAndPublish('/api/spectrum', {
      metadata: {
        ...rdmBase(),
        title: 'tiny.pwiz scan=19 – MS1 centroid',
        embedding: [parseFloat(randFloat()), parseFloat(randFloat())],
        msrun: { id: msrunId },
        native_id: 'scan=19',
        index: 0,
        default_array_length: 15,
        spectrum_type:           { id: 'MS:1000579' },
        spectrum_representation: { id: 'MS:1000127' },
        scan_polarity:           { id: 'MS:1000130' },
        spectrum_cv_params: [
          { accession: 'MS:1000511', name: 'ms level', value: '1' },
          { accession: 'MS:1000504', name: 'base peak m/z', value: '445.347', unit_accession: 'MS:1000040', unit_name: 'm/z' },
          { accession: 'MS:1000285', name: 'total ion current', value: '16675500' },
        ],
        scan_list: {
          spectra_combination: { id: 'MS:1000795' },
          scans: [{ cv_params: [{ accession: 'MS:1000016', name: 'scan start time', value: '5.8905', unit_accession: 'UO:0000031', unit_name: 'minute' }] }],
        },
        binary_data_array_list: [
          { encoded_length: 160, array_type: { accession: 'MS:1000514', name: 'm/z array', unit_accession: 'MS:1000040', unit_name: 'm/z' }, binary_data_type: { accession: 'MS:1000523', name: '64-bit float' }, compression_type: { accession: 'MS:1000576', name: 'no compression' }, binary: 'AAAAAAAAAAAAAAAAAADwPwAAAAAAAABAAAAAAAAACEAAAAAAAAAQQAAAAAAAABRAAAAAAAAAGEAAAAAAAAAcQAAAAAAAACBAAAAAAAAAIkAAAAAAAAAkQAAAAAAAACZAAAAAAAAAKEAAAAAAAAAqQAAAAAAAACxA' },
          { encoded_length: 160, array_type: { accession: 'MS:1000515', name: 'intensity array', unit_accession: 'MS:1000131', unit_name: 'number of counts' }, binary_data_type: { accession: 'MS:1000523', name: '64-bit float' }, compression_type: { accession: 'MS:1000576', name: 'no compression' }, binary: 'AAAAAAAALkAAAAAAAAAsQAAAAAAAACpAAAAAAAAAKEAAAAAAAAAmQAAAAAAAACRAAAAAAAAAIkAAAAAAAAAgQAAAAAAAABxAAAAAAAAAGEAAAAAAAAAUQAAAAAAAABBAAAAAAAAACEAAAAAAAAAAQAAAAAAAAPA/' },
        ],
      },
      files: { enabled: false },
    }, 'Spectrum scan=19', log)

    log('Done.')
    setCreatingExample(false)
  }

  // ── mzML folder import ────────────────────────────────────────────────────

  function handleFolderSelect(e) {
    const all = [...e.target.files]
    const files = all.filter(f => f.name.toLowerCase().endsWith('.xml'))
    setImportFiles(files)
    setImportLog([])
    if (all.length > 0 && files.length === 0)
      setImportLog([`No .xml files found (${all.length} other files ignored).`])
  }

  async function importFolder() {
    if (!datasetTitle.trim()) { setImportLog(['Please enter a dataset title.']); return }
    if (importFiles.length === 0) { setImportLog(['Please select a folder containing .xml (mzML) files.']); return }
    setImporting(true)
    setImportLog([])
    const log = (msg) => setImportLog(prev => [...prev, msg])

    // 1. Create dataset
    log(`Creating dataset "${datasetTitle}"…`)
    const dsId = await createAndPublish('/api/dataset', {
      metadata: { ...rdmBase(), title: datasetTitle },
      files: { enabled: false },
    }, 'Dataset', log)
    if (!dsId) { setImporting(false); return }

    // 2. Process each mzML file
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

      // 3. Create MSRun record
      log(`  Creating MSRun…`)
      const msrunTitle = `${datasetTitle} – ${file.name}`
      const msrunId = await createAndPublish('/api/msrun', {
        metadata: {
          ...rdmBase(),
          title: msrunTitle,
          dataset: { id: dsId },
          ...msrunMeta,
        },
        files: { enabled: false },
      }, 'MSRun', log)
      if (!msrunId) continue

      // 4. Create Spectrum records
      log(`  Creating ${spectra.length} spectrum records…`)
      let ok = 0, fail = 0
      for (const sp of spectra) {
        const spId = await createAndPublish('/api/spectrum', {
          metadata: {
            ...rdmBase(),
            title: `${file.name} – ${sp.native_id}`,
            embedding: Array.from({ length: 300 }, () => parseFloat((Math.random() * 2 - 1).toFixed(6))),
            msrun: { id: msrunId },
            ...sp,
          },
          files: { enabled: false },
        }, `Spectrum ${sp.native_id}`, () => {})  // suppress per-spectrum logs to avoid noise
        spId ? ok++ : fail++
      }
      log(`  Spectra: ${ok} published, ${fail} failed`)
    }

    log('\nImport complete.')
    setImporting(false)
  }

  // ── similarity search ─────────────────────────────────────────────────────

  async function similaritySearch() {
    setSearching(true); setSearchResults(null); setSearchError('')
    let parsed
    try {
      parsed = vector.split(',').map(s => {
        const n = parseFloat(s.trim())
        if (isNaN(n)) throw new Error(`"${s.trim()}" is not a number`)
        return n
      })
    } catch (e) { setSearchError(`Invalid vector: ${e.message}`); setSearching(false); return }

    const { ok, json } = await apiFetch('/api/spectrum/records/search-similar', {
      method: 'POST',
      body: JSON.stringify({ vector: parsed, k: parseInt(k, 10) }),
    })
    if (!ok) setSearchError(json.message || `Error ${json.status}`)
    else setSearchResults(json)
    setSearching(false)
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="app">
        <h1>Spectrum Admin</h1>
        <section className="card">
          <h2>Login</h2>
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
            <button type="submit" className="btn-primary" disabled={loggingIn} style={{ marginTop: '0.8rem' }}>
              {loggingIn ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="app">
      <h1>Spectrum Admin</h1>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.9rem', color: '#aaa' }}>Logged in as </span>
            <strong>{user.email}</strong>
            <span className="role-badge">admin</span>
          </div>
          <button onClick={handleLogout} className="btn-secondary">Log out</button>
        </div>
      </section>

      {/* ── mzML folder import ── */}
      <section className="card">
        <h2>Import mzML Folder</h2>
        <p className="hint">
          Select a folder of <code>.xml</code> (mzML) files. One Dataset is created, then one MSRun
          + its Spectrum records are created per file.
        </p>

        <div className="form-field">
          <label>Dataset title</label>
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
          <label>mzML folder</label>
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

      {/* ── test helpers ── */}
      <section className="card">
        <h2>Create 10 Test Records</h2>
        <p className="hint">Creates 10 spectrum records with random 2-dim embeddings and publishes them.</p>
        <button onClick={createRecords} disabled={creating} className="btn-primary">
          {creating ? 'Creating…' : 'Create 10 Records'}
        </button>
        {createLog.length > 0 && <pre className="log">{createLog.join('\n')}</pre>}
      </section>

      <section className="card">
        <h2>Create MS Dataset Example</h2>
        <p className="hint">
          Creates one Dataset, one MSRun, and one Spectrum record from <code>tiny.pwiz.1.1.mzML</code> data.
        </p>
        <button onClick={createMSDatasetExample} disabled={creatingExample} className="btn-primary">
          {creatingExample ? 'Creating…' : 'Create MS Dataset Example'}
        </button>
        {exampleLog.length > 0 && <pre className="log">{exampleLog.join('\n')}</pre>}
      </section>

      {/* ── similarity search ── */}
      <section className="card">
        <h2>Similarity Search</h2>
        <div className="row">
          <label className="grow">
            Vector (comma-separated floats)
            <input type="text" value={vector} onChange={e => setVector(e.target.value)} className="input-wide" placeholder="0.1, 0.9" />
          </label>
          <label>
            k
            <input type="number" value={k} onChange={e => setK(e.target.value)} className="input-k" min={1} max={100} />
          </label>
        </div>
        <button onClick={similaritySearch} disabled={searching} className="btn-primary">
          {searching ? 'Searching…' : 'Search Similar'}
        </button>

        {searchError && <p className="error">{searchError}</p>}

        {searchResults && (
          <div className="results">
            <p><strong>Total candidates:</strong> {searchResults.hits?.total ?? '—'}</p>
            <table>
              <thead><tr><th>#</th><th>ID</th><th>Title</th><th>Embedding</th></tr></thead>
              <tbody>
                {searchResults.hits?.hits?.map((hit, idx) => (
                  <tr key={hit.id}>
                    <td>{idx + 1}</td>
                    <td><code>{hit.id}</code></td>
                    <td>{hit.metadata?.title ?? '—'}</td>
                    <td><code>[{hit.metadata?.embedding?.join(', ') ?? '—'}]</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
