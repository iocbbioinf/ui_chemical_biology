import { useState, useEffect } from 'react'

function Row({ label, value }) {
  if (value == null || value === '') return null
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="py-1.5 pr-4 text-xs text-white/50 whitespace-nowrap w-2/5">{label}</td>
      <td className="py-1.5 text-sm">{value}</td>
    </tr>
  )
}

function SectionHeading({ children }) {
  return <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mt-4 mb-1">{children}</p>
}

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

  if (loading) return <div className="rounded-2xl bg-white/10 p-4"><p className="text-sm text-white/50">Loading…</p></div>
  if (error)   return <div className="rounded-2xl bg-white/10 p-4"><p className="text-red-400 text-sm">{error}</p></div>

  const m = record.metadata ?? {}

  const ic         = m.instrument_configurations?.[0]
  const instrument = ic?.instrument_model?.name
    ?? ic?.analyzers?.map(a => a.mass_analyzer_type?.name).filter(Boolean).join(' / ')
  const ionization = ic?.sources?.[0]?.ionization_type?.name
  const detector   = ic?.detectors?.[0]?.detector_type?.name

  const fileEntry = record.files?.enabled ? Object.values(record.files?.entries ?? {})[0] : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="rounded-full bg-white/15 px-4 py-2 text-sm text-white" onClick={onBack}>
          ← Back
        </button>
      </div>

      <div className="rounded-2xl bg-white/10 p-4">
        <p className="text-lg font-semibold">{m.run_id ?? record.id}</p>
        {m.title && <p className="text-sm text-white/50 mt-0.5">{m.title}</p>}

        <div className="grid gap-6 md:grid-cols-2 mt-2">
          <div>
            <SectionHeading>Run</SectionHeading>
            <table className="w-full">
              <tbody>
                <Row label="Run ID"  value={m.run_id} />
                <Row label="Started" value={m.start_time_stamp} />
                <Row label="Spectra" value={m.spectrum_count} />
                <Row label="Dataset" value={m.dataset?.metadata?.title} />
                {fileEntry && (
                  <tr className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 pr-4 text-xs text-white/50 whitespace-nowrap w-2/5">File</td>
                    <td className="py-1.5 text-sm">
                      <a href={`/api/msrun/${record.id}/files/${encodeURIComponent(fileEntry.key)}/content`} className="underline underline-offset-2 text-white/80 hover:text-white">
                        {fileEntry.key}
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {m.samples?.length > 0 && <>
              <SectionHeading>Samples</SectionHeading>
              <table className="w-full">
                <tbody>
                  {m.samples.map((s, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-4 text-xs text-white/50 whitespace-nowrap w-2/5">{s.name ?? s.sample_id ?? `Sample ${i + 1}`}</td>
                      <td className="py-1.5 text-sm">{s.cv_params?.map(p => p.value || p.name).filter(Boolean).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>}
          </div>

          <div>
            {ic && <>
              <SectionHeading>Instrument</SectionHeading>
              <table className="w-full">
                <tbody>
                  <Row label="Model"      value={instrument} />
                  <Row label="Ionization" value={ionization} />
                  <Row label="Detector"   value={detector} />
                  {ic.analyzers?.map((a, i) =>
                    a.mass_analyzer_type?.name
                      ? <Row key={i} label={`Analyzer${ic.analyzers.length > 1 ? ` ${i + 1}` : ''}`} value={a.mass_analyzer_type.name} />
                      : null
                  )}
                </tbody>
              </table>
            </>}

            <SectionHeading>Record</SectionHeading>
            <table className="w-full">
              <tbody>
                <Row label="ID"        value={record.id} />
                <Row label="Created"   value={record.created?.slice(0, 10)} />
                <Row label="Published" value={m.publication_date} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MsrunPage
