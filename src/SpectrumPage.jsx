import { useState, useEffect } from 'react'
import SpectrumGraph from './SpectrumGraph.jsx'

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

  const organism = msrunMeta?.samples
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

  async function handleSimilaritySearch() {
    if (!embedding || !onSimilaritySearch) return
    setSimSearching(true)
    await onSimilaritySearch(embedding)
    setSimSearching(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="rounded-full bg-white/15 px-4 py-2 text-sm text-white" onClick={onBack}>
          ← Back
        </button>
        {embedding && onSimilaritySearch && (
          <button className="rounded-full bg-white px-4 py-2 text-sm text-slate-950" onClick={handleSimilaritySearch} disabled={simSearching}>
            {simSearching ? 'Searching…' : 'Find Similar Spectra'}
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white/10 p-4">
        <p className="text-lg font-semibold break-all">{m.native_id ?? recordId}</p>
        {m.title && <p className="text-sm text-white/50 mt-0.5">{m.title}</p>}

        {m.binary_data_array_list?.length > 0 && (
          <>
            <SectionHeading>Peak Graph</SectionHeading>
            <SpectrumGraph binaryDataArrayList={m.binary_data_array_list} />
          </>
        )}

        <div className="grid gap-6 md:grid-cols-2 mt-2">
          <div>
            <SectionHeading>Spectrum</SectionHeading>
            <table className="w-full">
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
              <SectionHeading>Precursor</SectionHeading>
              <table className="w-full">
                <tbody>
                  <Row label="Selected ion m/z"    value={selIon?.selected_ion_mz != null ? selIon.selected_ion_mz.toFixed(4) : null} />
                  <Row label="Charge state"         value={selIon?.charge_state} />
                  <Row label="Intensity"            value={selIon?.intensity != null ? parseFloat(selIon.intensity).toExponential(3) : null} />
                  <Row label="Isolation target m/z" value={pre.isolation_window?.target_mz?.toFixed(4)} />
                  <Row label="Isolation window"     value={pre.isolation_window?.lower_offset != null ? `±${pre.isolation_window.lower_offset.toFixed(3)} Da` : null} />
                  <Row label="Dissociation method"  value={dissociation} />
                  <Row label="Activation energy"    value={pre.activation?.activation_energy != null ? `${pre.activation.activation_energy} eV` : null} />
                  <Row label="Precursor scan ref"   value={pre.spectrum_ref} />
                </tbody>
              </table>
            </>}
          </div>

          <div>
            {msrunMeta && <>
              <SectionHeading>MS Run</SectionHeading>
              <table className="w-full">
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
                <SectionHeading>Samples</SectionHeading>
                <table className="w-full">
                  <tbody>
                    {msrunMeta.samples.map((s, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="py-1.5 pr-4 text-xs text-white/50 whitespace-nowrap w-2/5">{s.name ?? s.sample_id}</td>
                        <td className="py-1.5 text-sm">{s.cv_params?.map(p => p.value || p.name).filter(Boolean).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>}
            </>}

            {recordId && <>
              <SectionHeading>Record</SectionHeading>
              <table className="w-full">
                <tbody>
                  <Row label="ID"        value={recordId} />
                  <Row label="Created"   value={recordCreated?.slice(0, 10)} />
                  <Row label="Published" value={m.publication_date} />
                </tbody>
              </table>
            </>}
          </div>
        </div>
      </div>
    </div>
  )
}

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

  if (loading) return <div className="rounded-2xl bg-white/10 p-4"><p className="text-sm text-white/50">Loading…</p></div>
  if (error)   return <div className="rounded-2xl bg-white/10 p-4"><p className="text-red-400 text-sm">{error}</p></div>

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
