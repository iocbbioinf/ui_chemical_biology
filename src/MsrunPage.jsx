import { useState, useEffect } from 'react'

// ── MsrunPage ─────────────────────────────────────────────────────────────────

function MsrunPage({ msrunId, onBack, apiFetch }) {
  const [record,  setRecord]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/msrun/${msrunId}`)
      if (cancelled) return
      if (!ok) { setError(json?.message || 'Failed to load MS run'); setLoading(false); return }
      setRecord(json); setLoading(false)
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

export default MsrunPage
