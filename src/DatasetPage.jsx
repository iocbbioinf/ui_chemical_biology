import { useState, useEffect } from 'react'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

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

function DatasetPage({ datasetId, onBack, apiFetch }) {
  const [record,  setRecord]  = useState(null)
  const [msruns,  setMsruns]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { ok, json } = await apiFetch(`/api/dataset/${datasetId}`)
      if (cancelled) return
      if (!ok) { setError(json?.message || 'Failed to load dataset'); setLoading(false); return }
      setRecord(json)
      const { ok: mok, json: mj } = await apiFetch(`/api/msrun?q=metadata.dataset.id:${datasetId}&size=100`)
      if (!cancelled && mok) {
        const hits = mj.hits?.hits ?? []
        const full = await Promise.all(hits.map(h => apiFetch(`/api/msrun/${h.id}`).then(r => r.ok ? r.json : h)))
        if (!cancelled) setMsruns(full)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [datasetId])

  if (loading) return <div className="rounded-2xl bg-white/10 p-4"><p className="text-sm text-white/50">Loading…</p></div>
  if (error)   return <div className="rounded-2xl bg-white/10 p-4"><p className="text-red-400 text-sm">{error}</p></div>

  const m = record.metadata ?? {}

  const species    = []
  const ptms       = []
  const edamTopics = []
  const keywords   = []
  for (const s of m.subjects ?? []) {
    const raw = s.subject ?? s.id ?? ''
    if (raw.startsWith('ncbitaxon::'))   species.push(raw.slice('ncbitaxon::'.length))
    else if (raw.startsWith('unimod::')) ptms.push(raw.slice('unimod::'.length))
    else if (raw.startsWith('edam::'))   edamTopics.push(raw.slice('edam::'.length))
    else if (s.scheme === 'NCBITaxon')   species.push(raw)
    else if (s.scheme === 'UNIMOD')      ptms.push(raw)
    else if (s.scheme === 'EDAM')        edamTopics.push(raw)
    else                                 keywords.push(raw)
  }

  const pi = m.contributors?.find(c => {
    const role = c.role
    if (!role) return false
    const id = typeof role === 'string' ? role : role.id ?? ''
    return id === 'ProjectLeader' || id.toLowerCase().includes('principal') || id === 'PIContactRole'
  })
  const piName        = pi?.person_or_org?.name ?? [pi?.person_or_org?.given_name, pi?.person_or_org?.family_name].filter(Boolean).join(' ') ?? null
  const piEmail       = pi?.person_or_org?.identifiers?.find(id => id.scheme === 'email')?.identifier ?? null
  const piAffiliation = pi?.affiliations?.[0]?.name ?? null
  const piCountry     = pi?.affiliations?.[0]?.id ?? null

  const abstract    = m.additional_descriptions?.find(d => d.type?.id === 'abstract')?.description
    ?? m.additional_descriptions?.[0]?.description ?? m.description ?? null
  const datasetType = edamTopics.length > 0 ? edamTopics.join(', ') : m.resource_type?.title?.en ?? m.resource_type?.id ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="rounded-full bg-white/15 px-4 py-2 text-sm text-white" onClick={onBack}>
          ← Back
        </button>
      </div>

      <div className="rounded-2xl bg-white/10 p-4">
        <p className="text-lg font-semibold">{m.title ?? record.id}</p>

        <SectionHeading>Dataset</SectionHeading>
        <table className="w-full">
          <tbody>
            <Row label="Title"        value={m.title} />
            <Row label="Description"  value={abstract} />
            <Row label="Dataset type" value={datasetType} />
            <Row label="Species"      value={species.join(', ') || null} />
            <Row label="PTMs"         value={ptms.join(', ') || null} />
            <Row label="Keywords"     value={keywords.join(', ') || null} />
            <Row label="Published"    value={m.publication_date} />
          </tbody>
        </table>

        {(piName || piEmail || piAffiliation || piCountry) && <>
          <SectionHeading>Principal Investigator</SectionHeading>
          <table className="w-full">
            <tbody>
              <Row label="Name"        value={piName} />
              <Row label="Email"       value={piEmail} />
              <Row label="Institution" value={piAffiliation} />
              <Row label="Country"     value={piCountry} />
            </tbody>
          </table>
        </>}

        {msruns.length > 0 && <>
          <SectionHeading>Files</SectionHeading>
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-1.5 pr-4 text-xs text-white/40 font-semibold text-left">Filename</th>
                <th className="py-1.5 text-xs text-white/40 font-semibold text-left">Size</th>
              </tr>
            </thead>
            <tbody>
              {msruns.map(r => {
                const fileEntry = Object.values(r.files?.entries ?? {})[0]
                const filename  = fileEntry?.key ?? r.metadata?.title?.split(' – ').slice(1).join(' – ') ?? r.id
                const href      = fileEntry ? `/api/msrun/${r.id}/files/${encodeURIComponent(fileEntry.key)}/content` : null
                return (
                  <tr key={r.id} className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 pr-4 text-sm">
                      {href ? <a href={href} className="underline underline-offset-2 text-white/80 hover:text-white">{filename}</a> : filename}
                    </td>
                    <td className="py-1.5 text-sm text-white/50">{fileEntry?.size != null ? formatBytes(fileEntry.size) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>}

        <SectionHeading>Record</SectionHeading>
        <table className="w-full">
          <tbody>
            <Row label="ID"      value={record.id} />
            <Row label="Created" value={record.created?.slice(0, 10)} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default DatasetPage
