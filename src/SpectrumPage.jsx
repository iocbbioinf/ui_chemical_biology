import { useState, useEffect } from 'react'
import SpectrumGraph from './SpectrumGraph.jsx'

// ── SpectrumDetail ────────────────────────────────────────────────────────────
// Pure rendering component. Accepts a pre-loaded metadata object `m` (the
// spectrum metadata), an optional `msrunMeta` object (the msrun metadata fields),
// an optional repo `recordId` / `recordCreated` for the Record section,
// and action callbacks.

function SpectrumDetail({ m, msrunMeta, recordId, recordCreated, onBack, onSimilaritySearch }) {
  const [simSearching, setSimSearching] = useState(false)

  const cvVal = (params, acc) => params?.find(p => p.accession === acc)?.value

  const retentionTime = cvVal(m.scan_list?.scans?.[0]?.cv_params, 'MS:1000016')
  const msLevel       = cvVal(m.spectrum_cv_params, 'MS:1000511')
  const basePeakMz    = cvVal(m.spectrum_cv_params, 'MS:1000504')
  const basePeakInt   = cvVal(m.spectrum_cv_params, 'MS:1000505')
  const tic           = cvVal(m.spectrum_cv_params, 'MS:1000285')
  const lowestMz      = cvVal(m.spectrum_cv_params, 'MS:1000528')
  const highestMz     = cvVal(m.spectrum_cv_params, 'MS:1000527')
  const filterStr     = cvVal(m.scan_list?.scans?.[0]?.cv_params, 'MS:1000512')
  const molFormula    = cvVal(m.spectrum_cv_params, 'MS:1000866')
    ?? m.spectrum_cv_params?.find(p => p.name?.toLowerCase().includes('formula'))?.value

  const organism      = msrunMeta?.samples
    ?.flatMap(s => s.cv_params ?? [])
    .find(p => p.accession === 'MS:1001469' || p.name?.toLowerCase().includes('organism') || p.name?.toLowerCase().includes('taxon'))
    ?.value

  const pre          = m.precursor_list?.[0]
  const selIon       = pre?.selected_ions?.[0]
  const dissociation = pre?.activation?.dissociation_method?.title?.en ?? pre?.activation?.dissociation_method?.id

  const ic         = msrunMeta?.instrument_configurations?.[0]
  const instrument = ic?.instrument_model?.name
    ?? ic?.analyzers?.map(a => a.mass_analyzer_type?.name).filter(Boolean).join(' / ')
  const ionization = ic?.sources?.[0]?.ionization_type?.name

  const embedding = m.dreams_embedding

  function Row({ label, value }) {
    if (value == null || value === '') return null
    return <tr><td className="sp-label">{label}</td><td>{value}</td></tr>
  }

  async function handleSimilaritySearch() {
    if (!embedding || !onSimilaritySearch) return
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
        {embedding && onSimilaritySearch && (
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
        <h2 className="sp-title">{m.native_id ?? recordId}</h2>
        <p className="hint">{m.title}</p>

        {m.binary_data_array_list?.length > 0 && (
          <>
            <h3 className="sp-section">Peak Graph</h3>
            <SpectrumGraph binaryDataArrayList={m.binary_data_array_list} />
          </>
        )}

        <div className="sp-grid">
          <div>
            <h3 className="sp-section">Spectrum</h3>
            <table className="sp-table">
              <tbody>
                <Row label="Spectrum type"       value={m.spectrum_type?.title?.en} />
                <Row label="Representation"      value={m.spectrum_representation?.title?.en} />
                <Row label="Polarity"            value={m.scan_polarity?.title?.en} />
                <Row label="MS level"            value={msLevel} />
                <Row label="Molecular formula"   value={molFormula} />
                <Row label="Organism"            value={organism} />
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
            {msrunMeta && <>
              <h3 className="sp-section">MS Run</h3>
              <table className="sp-table">
                <tbody>
                  <Row label="Run ID"     value={msrunMeta.run_id} />
                  <Row label="Dataset"    value={msrunMeta.dataset?.metadata?.title} />
                  <Row label="Instrument" value={instrument} />
                  <Row label="Ionization" value={ionization} />
                  <Row label="Started"    value={msrunMeta.start_time_stamp} />
                  <Row label="Spectra"    value={msrunMeta.spectrum_count} />
                </tbody>
              </table>

              {msrunMeta.samples?.length > 0 && <>
                <h3 className="sp-section">Samples</h3>
                <table className="sp-table">
                  <tbody>
                    {msrunMeta.samples.map((s, i) => (
                      <tr key={i}>
                        <td className="sp-label">{s.name ?? s.sample_id}</td>
                        <td>{s.cv_params?.map(p => p.value || p.name).filter(Boolean).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>}
            </>}

            {recordId && (
              <>
                <h3 className="sp-section">Record</h3>
                <table className="sp-table">
                  <tbody>
                    <Row label="ID"        value={recordId} />
                    <Row label="Created"   value={recordCreated?.slice(0, 10)} />
                    <Row label="Published" value={m.publication_date} />
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── SpectrumPage ──────────────────────────────────────────────────────────────

function SpectrumPage({ spectrumId, onBack, onSimilaritySearch, apiFetch }) {
  const [record,  setRecord]  = useState(null)
  const [msrun,   setMsrun]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/spectrum/${spectrumId}`)
      if (cancelled) return; if (!ok) { setError(json?.message || 'Failed to load spectrum'); setLoading(false); return }
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

  return (
    <SpectrumDetail
      m={record.metadata ?? {}}
      msrunMeta={msrun?.metadata}
      recordId={record.id}
      recordCreated={record.created}
      onBack={onBack}
      onSimilaritySearch={onSimilaritySearch}
    />
  )
}

export { SpectrumDetail }
export default SpectrumPage
