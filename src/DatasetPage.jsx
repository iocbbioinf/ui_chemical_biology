import { useState, useEffect } from 'react'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// ── DatasetPage ───────────────────────────────────────────────────────────────

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

  if (loading) return <div className="card"><p className="hint">Loading…</p></div>
  if (error)   return <div className="card"><p className="error">{error}</p></div>

  const m = record.metadata ?? {}

  function Row({ label, value }) {
    if (value == null || value === '') return null
    return <tr><td className="sp-label">{label}</td><td>{value}</td></tr>
  }

  // subjects: encoded as "prefix::value" since API's scheme field is dump_only
  const species   = []
  const ptms      = []
  const edamTopics = []
  const keywords  = []
  for (const s of m.subjects ?? []) {
    const raw = s.subject ?? s.id ?? ''
    if (raw.startsWith('ncbitaxon::'))      species.push(raw.slice('ncbitaxon::'.length))
    else if (raw.startsWith('unimod::'))    ptms.push(raw.slice('unimod::'.length))
    else if (raw.startsWith('edam::'))      edamTopics.push(raw.slice('edam::'.length))
    else if (s.scheme === 'NCBITaxon')      species.push(raw)
    else if (s.scheme === 'UNIMOD')         ptms.push(raw)
    else if (s.scheme === 'EDAM')           edamTopics.push(raw)
    else                                    keywords.push(raw)
  }

  // principal investigator: contributor with role ProjectLeader
  const pi = m.contributors?.find(c => {
    const role = c.role
    if (!role) return false
    const id = typeof role === 'string' ? role : role.id ?? ''
    return id === 'ProjectLeader' || id.toLowerCase().includes('principal') || id === 'PIContactRole'
  })
  const piName = pi?.person_or_org?.name
    ?? [pi?.person_or_org?.given_name, pi?.person_or_org?.family_name].filter(Boolean).join(' ')
    ?? null
  const piEmail = pi?.person_or_org?.identifiers?.find(id => id.scheme === 'email')?.identifier ?? null
  const piAffiliation = pi?.affiliations?.[0]?.name ?? null
  const piCountry = pi?.affiliations?.[0]?.id ?? null

  // description: prefer additional_descriptions abstract, fall back to local description field
  const abstract = m.additional_descriptions?.find(d => d.type?.id === 'abstract')?.description
    ?? m.additional_descriptions?.[0]?.description
    ?? m.description
    ?? null

  // dataset type: from EDAM subject prefix, fallback to resource_type title
  const datasetType = edamTopics.length > 0 ? edamTopics.join(', ') : m.resource_type?.title?.en ?? m.resource_type?.id ?? null

  return (
    <div>
      <div className="sp-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          ← Back to results
        </button>
      </div>

      <section className="card">
        <h2 className="sp-title">{m.title ?? record.id}</h2>

        <h3 className="sp-section" style={{ marginTop: '0.5rem' }}>Dataset</h3>
        <table className="sp-table">
          <tbody>
            <Row label="Title"                        value={m.title} />
            <Row label="Description"                  value={abstract} />
            <Row label="Dataset type"                 value={datasetType} />
            <Row label="Species"                      value={species.join(', ') || null} />
            <Row label="Post-Translational Modifications" value={ptms.join(', ') || null} />
            <Row label="Keywords"                     value={keywords.join(', ') || null} />
            <Row label="Published"                    value={m.publication_date} />
          </tbody>
        </table>

        {(piName || piEmail || piAffiliation || piCountry) && <>
          <h3 className="sp-section">Principal Investigator</h3>
          <table className="sp-table">
            <tbody>
              <Row label="Name"        value={piName} />
              <Row label="Email"       value={piEmail} />
              <Row label="Institution" value={piAffiliation} />
              <Row label="Country"     value={piCountry} />
            </tbody>
          </table>
        </>}

        {msruns.length > 0 && <>
          <h3 className="sp-section">Files</h3>
          <table className="sp-table">
            <thead>
              <tr><th className="sp-label">Filename</th><th>Size</th></tr>
            </thead>
            <tbody>
              {msruns.map(r => {
                const fileEntry = Object.values(r.files?.entries ?? {})[0]
                const filename = fileEntry?.key ?? r.metadata?.title?.split(' – ').slice(1).join(' – ') ?? r.id
                const href = fileEntry ? `/api/msrun/${r.id}/files/${encodeURIComponent(fileEntry.key)}/content` : null
                return (
                  <tr key={r.id}>
                    <td>{href ? <a href={href}>{filename}</a> : filename}</td>
                    <td>{fileEntry?.size != null ? formatBytes(fileEntry.size) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>}

        <h3 className="sp-section">Record</h3>
        <table className="sp-table">
          <tbody>
            <Row label="ID"      value={record.id} />
            <Row label="Created" value={record.created?.slice(0, 10)} />
          </tbody>
        </table>
      </section>
    </div>
  )
}

export default DatasetPage
