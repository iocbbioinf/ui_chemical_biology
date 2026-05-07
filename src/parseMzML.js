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

export { parseMzML }
