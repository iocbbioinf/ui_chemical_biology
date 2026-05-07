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

export { today, rdmBase }
