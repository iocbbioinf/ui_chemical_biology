import { useState, useEffect, useRef } from 'react'

// ── SpectrumGraph ─────────────────────────────────────────────────────────────

function decodeFloatArray(base64, is32bit) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const buf = bytes.buffer
  return is32bit ? Array.from(new Float32Array(buf)) : Array.from(new Float64Array(buf))
}

function extractPeaks(binaryDataArrayList) {
  if (!binaryDataArrayList?.length) return null
  let mzArr = null, intArr = null
  for (const bda of binaryDataArrayList) {
    const accession = bda.array_type?.accession
    const is32 = bda.binary_data_type?.accession === 'MS:1000521'
    const binary = bda.binary?.trim()
    if (!binary) continue
    try {
      const vals = decodeFloatArray(binary, is32)
      if (accession === 'MS:1000514') mzArr = vals       // m/z array
      else if (accession === 'MS:1000515') intArr = vals  // intensity array
    } catch { /* skip malformed */ }
  }
  if (!mzArr || !intArr || mzArr.length !== intArr.length || mzArr.length === 0) return null
  return { mzArr, intArr }
}

function SpectrumGraph({ binaryDataArrayList }) {
  const [tooltip, setTooltip] = useState(null)
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const svgRef = useRef(null)

  const peaks = extractPeaks(binaryDataArrayList)
  if (!peaks) return <p className="hint" style={{ marginTop: '0.75rem' }}>No peak data available.</p>

  const { mzArr, intArr } = peaks
  const maxInt = Math.max(...intArr)
  const normInt = intArr.map(v => v / maxInt)

  const W = 700, H = 160
  const PAD = { top: 14, right: 18, bottom: 36, left: 54 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const minMz = Math.min(...mzArr)
  const maxMz = Math.max(...mzArr)
  const mzSpan = maxMz - minMz || 1

  const toX = mz => PAD.left + ((mz - minMz) / mzSpan) * plotW
  const toY = ni => PAD.top + plotH - ni * plotH

  // x-axis ticks
  const tickCount = 6
  const mzTicks = Array.from({ length: tickCount + 1 }, (_, i) => minMz + (mzSpan * i) / tickCount)

  // y-axis ticks (0, 25, 50, 75, 100 %)
  const yTicks = [0, 25, 50, 75, 100]

  function handleMouseMove(e, idx) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setHoveredIdx(idx)
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      mz: mzArr[idx],
      int: intArr[idx],
      rel: (normInt[idx] * 100).toFixed(1),
    })
  }

  function handleMouseLeave() {
    setHoveredIdx(null)
    setTooltip(null)
  }

  return (
    <div style={{ position: 'relative', marginTop: '0.75rem' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={handleMouseLeave}
      >
        {/* y-axis grid lines + labels */}
        {yTicks.map(t => {
          const y = toY(t / 100)
          return (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y}
                stroke="#2a2a2a" strokeWidth="1" />
              <text x={PAD.left - 6} y={y + 3.5} textAnchor="end"
                fontSize="9" fill="#666">{t}</text>
            </g>
          )
        })}

        {/* x-axis ticks + labels */}
        {mzTicks.map((mz, i) => {
          const x = toX(mz)
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={PAD.top + plotH} y2={PAD.top + plotH + 4}
                stroke="#555" strokeWidth="1" />
              <text x={x} y={PAD.top + plotH + 14} textAnchor="middle"
                fontSize="9" fill="#888">{mz.toFixed(1)}</text>
            </g>
          )
        })}

        {/* axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 2} textAnchor="middle"
          fontSize="9.5" fill="#888">m/z</text>
        <text
          transform={`rotate(-90) translate(${-(PAD.top + plotH / 2)}, ${PAD.left - 40})`}
          textAnchor="middle" fontSize="9.5" fill="#888">Relative intensity (%)</text>

        {/* baseline */}
        <line x1={PAD.left} x2={PAD.left + plotW}
          y1={PAD.top + plotH} y2={PAD.top + plotH}
          stroke="#555" strokeWidth="1" />

        {/* peaks */}
        {mzArr.map((mz, i) => {
          const x = toX(mz)
          const y = toY(normInt[i])
          const isHovered = hoveredIdx === i
          const color = isHovered ? '#ffffff' : 'rgba(255,255,255,0.6)'
          return (
            <g key={i}>
              <line
                x1={x} x2={x}
                y1={PAD.top + plotH} y2={y}
                stroke={color} strokeWidth={isHovered ? 1.8 : 1}
              />
              {/* invisible wide hit area for hover */}
              <line
                x1={x} x2={x}
                y1={PAD.top + plotH} y2={y}
                stroke="transparent" strokeWidth="10"
                style={{ cursor: 'crosshair' }}
                onMouseMove={e => handleMouseMove(e, i)}
              />
              <circle cx={x} cy={y} r={isHovered ? 3 : 2}
                fill="none" stroke={color} strokeWidth="1"
                pointerEvents="none"
              />
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x + 10,
          top: tooltip.y - 36,
          background: '#222',
          border: '1px solid #555',
          borderRadius: 5,
          padding: '4px 8px',
          fontSize: '0.78rem',
          color: '#eee',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          <strong>m/z</strong> {tooltip.mz.toFixed(4)}<br />
          <strong>int</strong> {tooltip.rel}%
        </div>
      )}
    </div>
  )
}

export default SpectrumGraph
