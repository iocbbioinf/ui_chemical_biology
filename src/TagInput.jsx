import { useState, useRef } from 'react'

// ── TagInput ──────────────────────────────────────────────────────────────────

const DATASET_TYPE_SUGGESTIONS = [
  'Proteomics', 'Metabolomics', 'Genomics', 'Transcriptomics',
  'Lipidomics', 'Glycomics', 'Structural biology', 'Imaging',
]

const SPECIES_SUGGESTIONS = [
  'Homo sapiens', 'Mus musculus', 'Rattus norvegicus', 'Danio rerio',
  'Drosophila melanogaster', 'Caenorhabditis elegans', 'Saccharomyces cerevisiae',
  'Arabidopsis thaliana', 'Escherichia coli', 'Bacillus subtilis',
]

const PTM_SUGGESTIONS = [
  'Phosphorylation', 'Ubiquitination', 'Acetylation', 'Methylation',
  'Glycosylation', 'SUMOylation', 'Oxidation', 'Deamidation',
  'Carbamidomethylation', 'Hydroxylation', 'Palmitoylation', 'Nitrosylation',
]

function TagInput({ values, onChange, suggestions = [], placeholder, disabled, listId, maxItems = Infinity }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  function addTag(val) {
    const trimmed = val.trim()
    if (trimmed && !values.includes(trimmed) && values.length < maxItems) onChange([...values, trimmed])
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function handleChange(e) {
    const val = e.target.value
    if (val.endsWith(',')) { addTag(val.slice(0, -1)); return }
    // datalist selection fires change with full value — add immediately if it matches a suggestion
    if (suggestions.includes(val.trim())) { addTag(val); return }
    setInput(val)
  }

  function handleBlur() {
    if (input.trim()) addTag(input)
  }

  return (
    <div className={`tag-input${disabled ? ' tag-input--disabled' : ''}`} onClick={() => inputRef.current?.focus()}>
      {values.map(v => (
        <span key={v} className="tag">
          {v}
          {!disabled && <button type="button" className="tag-remove" onClick={e => { e.stopPropagation(); onChange(values.filter(x => x !== v)) }}>×</button>}
        </span>
      ))}
      {values.length < maxItems && (
        <input
          ref={inputRef}
          list={listId}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={values.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="tag-input__field"
        />
      )}
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.filter(s => !values.includes(s)).map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  )
}

export { DATASET_TYPE_SUGGESTIONS, SPECIES_SUGGESTIONS, PTM_SUGGESTIONS }
export default TagInput
