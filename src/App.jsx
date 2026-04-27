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

// ── SpectrumPage ──────────────────────────────────────────────────────────────

function SpectrumPage({ spectrumId, onBack, onSimilaritySearch, apiFetch }) {
  const [record,          setRecord]          = useState(null)
  const [msrun,           setMsrun]           = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState('')
  const [simSearching,    setSimSearching]     = useState(false)

  useState(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/spectrum/${spectrumId}`)
      if (!ok || cancelled) { setError(json?.message || 'Failed to load spectrum'); setLoading(false); return }
      setRecord(json)
      const msrunId = json.metadata?.msrun?.id
      if (msrunId) {
        const { ok: mok, json: mj } = await apiFetch(`/api/msrun/${msrunId}`)
        if (!cancelled && mok) setMsrun(mj)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [spectrumId])

  if (loading) return <div className="card"><p className="hint">Loading…</p></div>
  if (error)   return <div className="card"><p className="error">{error}</p></div>

  const m = record.metadata ?? {}
  const cvVal = (params, acc) => params?.find(p => p.accession === acc)?.value

  const retentionTime = cvVal(m.scan_list?.scans?.[0]?.cv_params, 'MS:1000016')
  const msLevel       = cvVal(m.spectrum_cv_params, 'MS:1000511')
  const basePeakMz    = cvVal(m.spectrum_cv_params, 'MS:1000504')
  const basePeakInt   = cvVal(m.spectrum_cv_params, 'MS:1000505')
  const tic           = cvVal(m.spectrum_cv_params, 'MS:1000285')
  const lowestMz      = cvVal(m.spectrum_cv_params, 'MS:1000528')
  const highestMz     = cvVal(m.spectrum_cv_params, 'MS:1000527')
  const filterStr     = cvVal(m.scan_list?.scans?.[0]?.cv_params, 'MS:1000512')

  const pre          = m.precursor_list?.[0]
  const selIon       = pre?.selected_ions?.[0]
  const dissociation = pre?.activation?.dissociation_method?.title?.en ?? pre?.activation?.dissociation_method?.id

  const ic           = msrun?.metadata?.instrument_configurations?.[0]
  const instrument   = ic?.instrument_model?.name
    ?? ic?.analyzers?.map(a => a.mass_analyzer_type?.name).filter(Boolean).join(' / ')
  const ionization   = ic?.sources?.[0]?.ionization_type?.name

  function Row({ label, value }) {
    if (value == null || value === '') return null
    return <tr><td className="sp-label">{label}</td><td>{value}</td></tr>
  }

  const embedding = record?.metadata?.dreams_embedding

  async function handleSimilaritySearch() {
    if (!embedding) return
    setSimSearching(true)
    await onSimilaritySearch(embedding)
    setSimSearching(false)
  }

  return (
    <div>
      <div className="sp-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          ← Back to results
        </button>
        {embedding && (
          <button
            className="btn-primary btn-sm"
            onClick={handleSimilaritySearch}
            disabled={simSearching}
          >
            {simSearching ? 'Searching…' : 'Find Similar Spectra'}
          </button>
        )}
      </div>

      <section className="card">
        <h2 className="sp-title">{m.native_id ?? record.id}</h2>
        <p className="hint">{m.title}</p>

        <div className="sp-grid">
          <div>
            <h3 className="sp-section">Spectrum</h3>
            <table className="sp-table">
              <tbody>
                <Row label="Spectrum type"       value={m.spectrum_type?.title?.en} />
                <Row label="Representation"      value={m.spectrum_representation?.title?.en} />
                <Row label="Polarity"            value={m.scan_polarity?.title?.en} />
                <Row label="MS level"            value={msLevel} />
                <Row label="Retention time"      value={retentionTime ? `${parseFloat(retentionTime).toFixed(4)} min` : null} />
                <Row label="Base peak m/z"       value={basePeakMz ? parseFloat(basePeakMz).toFixed(4) : null} />
                <Row label="Base peak intensity" value={basePeakInt ? parseFloat(basePeakInt).toExponential(3) : null} />
                <Row label="Total ion current"   value={tic ? parseFloat(tic).toExponential(3) : null} />
                <Row label="m/z range"           value={lowestMz && highestMz ? `${parseFloat(lowestMz).toFixed(3)} – ${parseFloat(highestMz).toFixed(3)}` : null} />
                <Row label="Filter string"       value={filterStr} />
              </tbody>
            </table>

            {pre && <>
              <h3 className="sp-section">Precursor</h3>
              <table className="sp-table">
                <tbody>
                  <Row label="Selected ion m/z"     value={selIon?.selected_ion_mz != null ? selIon.selected_ion_mz.toFixed(4) : null} />
                  <Row label="Charge state"          value={selIon?.charge_state} />
                  <Row label="Intensity"             value={selIon?.intensity != null ? parseFloat(selIon.intensity).toExponential(3) : null} />
                  <Row label="Isolation target m/z"  value={pre.isolation_window?.target_mz?.toFixed(4)} />
                  <Row label="Isolation window"      value={pre.isolation_window?.lower_offset != null ? `±${pre.isolation_window.lower_offset.toFixed(3)} Da` : null} />
                  <Row label="Dissociation method"   value={dissociation} />
                  <Row label="Activation energy"     value={pre.activation?.activation_energy != null ? `${pre.activation.activation_energy} eV` : null} />
                  <Row label="Precursor scan ref"    value={pre.spectrum_ref} />
                </tbody>
              </table>
            </>}
          </div>

          <div>
            {msrun && <>
              <h3 className="sp-section">MS Run</h3>
              <table className="sp-table">
                <tbody>
                  <Row label="Run ID"     value={msrun.metadata?.run_id} />
                  <Row label="Dataset"    value={msrun.metadata?.dataset?.metadata?.title} />
                  <Row label="Instrument" value={instrument} />
                  <Row label="Ionization" value={ionization} />
                  <Row label="Started"    value={msrun.metadata?.start_time_stamp} />
                  <Row label="Spectra"    value={msrun.metadata?.spectrum_count} />
                </tbody>
              </table>

              {msrun.metadata?.samples?.length > 0 && <>
                <h3 className="sp-section">Samples</h3>
                <table className="sp-table">
                  <tbody>
                    {msrun.metadata.samples.map((s, i) => (
                      <tr key={i}>
                        <td className="sp-label">{s.name ?? s.sample_id}</td>
                        <td>{s.cv_params?.map(p => p.value || p.name).filter(Boolean).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>}
            </>}

            <h3 className="sp-section">Record</h3>
            <table className="sp-table">
              <tbody>
                <Row label="ID"        value={record.id} />
                <Row label="Created"   value={record.created?.slice(0, 10)} />
                <Row label="Published" value={m.publication_date} />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── DatasetPage ───────────────────────────────────────────────────────────────

function DatasetPage({ datasetId, onBack, apiFetch }) {
  const [record,  setRecord]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useState(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/dataset/${datasetId}`)
      if (!ok || cancelled) { setError(json?.message || 'Failed to load dataset'); setLoading(false); return }
      if (!cancelled) { setRecord(json); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [datasetId])

  if (loading) return <div className="card"><p className="hint">Loading…</p></div>
  if (error)   return <div className="card"><p className="error">{error}</p></div>

  const m = record.metadata ?? {}

  function Row({ label, value }) {
    if (value == null || value === '') return null
    return <tr><td className="sp-label">{label}</td><td>{value}</td></tr>
  }

  const creators = m.creators?.map(c =>
    c.person_or_org?.name ?? [c.person_or_org?.given_name, c.person_or_org?.family_name].filter(Boolean).join(' ')
  ).filter(Boolean)

  const languages = m.languages?.map(l => l.title?.en ?? l.id).filter(Boolean)

  return (
    <div>
      <div className="sp-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          ← Back to results
        </button>
      </div>

      <section className="card">
        <h2 className="sp-title">{m.title ?? record.id}</h2>

        {m.description && <p className="dataset-description">{m.description}</p>}

        <div className="sp-grid">
          <div>
            <h3 className="sp-section">Dataset</h3>
            <table className="sp-table">
              <tbody>
                <Row label="Title"            value={m.title} />
                <Row label="Published"        value={m.publication_date} />
                <Row label="Languages"        value={languages?.join(', ')} />
              </tbody>
            </table>

            {creators?.length > 0 && <>
              <h3 className="sp-section">Creators</h3>
              <table className="sp-table">
                <tbody>
                  {creators.map((name, i) => (
                    <tr key={i}><td>{name}</td></tr>
                  ))}
                </tbody>
              </table>
            </>}
          </div>

          <div>
            <h3 className="sp-section">Record</h3>
            <table className="sp-table">
              <tbody>
                <Row label="ID"        value={record.id} />
                <Row label="Created"   value={record.created?.slice(0, 10)} />
                <Row label="Published" value={m.publication_date} />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── MsrunPage ─────────────────────────────────────────────────────────────────

function MsrunPage({ msrunId, onBack, apiFetch }) {
  const [record,  setRecord]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useState(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/msrun/${msrunId}`)
      if (!ok || cancelled) { setError(json?.message || 'Failed to load MS run'); setLoading(false); return }
      if (!cancelled) { setRecord(json); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [msrunId])

  if (loading) return <div className="card"><p className="hint">Loading…</p></div>
  if (error)   return <div className="card"><p className="error">{error}</p></div>

  const m = record.metadata ?? {}

  const ic          = m.instrument_configurations?.[0]
  const instrument  = ic?.instrument_model?.name
    ?? ic?.analyzers?.map(a => a.mass_analyzer_type?.name).filter(Boolean).join(' / ')
  const ionization  = ic?.sources?.[0]?.ionization_type?.name
  const detector    = ic?.detectors?.[0]?.detector_type?.name

  function Row({ label, value }) {
    if (value == null || value === '') return null
    return <tr><td className="sp-label">{label}</td><td>{value}</td></tr>
  }

  return (
    <div>
      <div className="sp-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          ← Back to results
        </button>
      </div>

      <section className="card">
        <h2 className="sp-title">{m.run_id ?? record.id}</h2>
        <p className="hint">{m.title}</p>

        <div className="sp-grid">
          <div>
            <h3 className="sp-section">Run</h3>
            <table className="sp-table">
              <tbody>
                <Row label="Run ID"        value={m.run_id} />
                <Row label="Started"       value={m.start_time_stamp} />
                <Row label="Spectra"       value={m.spectrum_count} />
                <Row label="Dataset"       value={m.dataset?.metadata?.title} />
              </tbody>
            </table>

            {m.samples?.length > 0 && <>
              <h3 className="sp-section">Samples</h3>
              <table className="sp-table">
                <tbody>
                  {m.samples.map((s, i) => (
                    <tr key={i}>
                      <td className="sp-label">{s.name ?? s.sample_id ?? `Sample ${i + 1}`}</td>
                      <td>{s.cv_params?.map(p => p.value || p.name).filter(Boolean).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>}
          </div>

          <div>
            {ic && <>
              <h3 className="sp-section">Instrument</h3>
              <table className="sp-table">
                <tbody>
                  <Row label="Model"       value={instrument} />
                  <Row label="Ionization"  value={ionization} />
                  <Row label="Detector"    value={detector} />
                  {ic.analyzers?.map((a, i) => (
                    a.mass_analyzer_type?.name
                      ? <Row key={i} label={`Analyzer ${ic.analyzers.length > 1 ? i + 1 : ''}`} value={a.mass_analyzer_type.name} />
                      : null
                  ))}
                </tbody>
              </table>
            </>}

            <h3 className="sp-section">Record</h3>
            <table className="sp-table">
              <tbody>
                <Row label="ID"        value={record.id} />
                <Row label="Created"   value={record.created?.slice(0, 10)} />
                <Row label="Published" value={m.publication_date} />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
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
  const [showLoginModal, setShowLoginModal] = useState(false)

  // ── tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('search')

  // ── record creation state ─────────────────────────────────────────────────
  const [creating, setCreating]         = useState(false)
  const [createLog, setCreateLog]       = useState([])
  const [creatingExample, setCreatingExample] = useState(false)
  const [exampleLog, setExampleLog]     = useState([])

  // ── mzML folder import state ──────────────────────────────────────────────
  const [importFiles, setImportFiles]   = useState([])
  const [datasetTitle, setDatasetTitle] = useState('')
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
  const [spectrumPage, setSpectrumPage]     = useState(null)
  const [msrunPage, setMsrunPage]           = useState(null)
  const [datasetPage, setDatasetPage]       = useState(null)

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
    setShowLoginModal(false)
    setEmail('')
    setPassword('')
  }

  function handleLogout() {
    setUser(null); setToken(''); setEmail(''); setPassword('')
    setCreateLog([]); setExampleLog([]); setImportLog([]); setSearchResults(null)
    if (activeTab === 'import') setActiveTab('search')
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

    log(`Creating dataset "${datasetTitle}"…`)
    const dsId = await createAndPublish('/api/dataset', {
      metadata: { ...rdmBase(), title: datasetTitle },
      files: { enabled: false },
    }, 'Dataset', log)
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
      }, 'MSRun', log)
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
            ...(embedding ? { embedding } : {}),
            dataset: { id: dsId },
            msrun: { id: msrunId },
            ...sp,
          },
          files: { enabled: false },
        }, `Spectrum ${sp.native_id}`, () => {})
        spId ? ok++ : fail++
      }
      log(`  Spectra: ${ok} published, ${fail} failed`)
    }

    log('\nImport complete.')
    setImporting(false)
  }

  // ── spectra search ────────────────────────────────────────────────────────

  async function searchSpectra() {
    setSearching(true); setSearchResults(null); setSearchError('')

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
    const url = `/api/spectrum?q=${encodeURIComponent(q)}&size=50`

    const { ok, json } = await apiFetch(url)
    if (!ok) { setSearchError(json.message || `Search failed (${json.status ?? 'unknown'})`); setSearching(false); return }

    // collect unique msrun IDs from hits
    const msrunIds = [...new Set(
      (json.hits?.hits ?? []).map(h => h.metadata?.msrun?.id).filter(Boolean)
    )]

    // fetch all msrun records in parallel
    const msrunMap = {}
    await Promise.all(msrunIds.map(async id => {
      const { ok: mok, json: mj } = await apiFetch(`/api/msrun/${id}`)
      if (mok) msrunMap[id] = mj
    }))

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
      {activeTab === 'search' && spectrumPage && (
        <SpectrumPage
          spectrumId={spectrumPage}
          onBack={() => setSpectrumPage(null)}
          onSimilaritySearch={searchSimilar}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !spectrumPage && msrunPage && (
        <MsrunPage
          msrunId={msrunPage}
          onBack={() => setMsrunPage(null)}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !spectrumPage && !msrunPage && datasetPage && (
        <DatasetPage
          datasetId={datasetPage}
          onBack={() => setDatasetPage(null)}
          apiFetch={apiFetch}
        />
      )}
      {activeTab === 'search' && !spectrumPage && !msrunPage && !datasetPage && (
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
          </div>

          <button onClick={searchSpectra} disabled={searching} className="btn-primary search-btn">
            {searching ? 'Searching…' : 'Search'}
          </button>

          {searchError && <p className="error">{searchError}</p>}

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

            if (sortCol) {
              rows.sort((a, b) => {
                const av = a[sortCol] ?? ''
                const bv = b[sortCol] ?? ''
                const cmp = typeof av === 'number' && typeof bv === 'number'
                  ? av - bv
                  : String(av).localeCompare(String(bv), undefined, { numeric: true })
                return sortDir === 'asc' ? cmp : -cmp
              })
            }

            function SortTh({ col, children, className }) {
              const active = sortCol === col
              const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
              return (
                <th
                  className={`sortable${active ? ' sort-active' : ''}${className ? ' ' + className : ''}`}
                  onClick={() => {
                    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                    else { setSortCol(col); setSortDir('asc') }
                  }}
                >{children}{indicator}</th>
              )
            }

            return (
              <div className="results">
                <p className="results-count">
                  <strong>{searchResults.hits?.total?.value ?? searchResults.hits?.total ?? 0}</strong> spectra found
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortTh col="scanId" className="col-name">Scan ID</SortTh>                      <SortTh col="precMz">Precursor m/z</SortTh>
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
                            <td>{idx + 1}</td>
                            <td className="col-name" title={r.scanId}>
                              <button className="link-btn" onClick={() => setSpectrumPage(r.sourceId)}>
                                {r.scanId || r.sourceId}
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
        </>
      )}
    </div>
  )
}

export default App
