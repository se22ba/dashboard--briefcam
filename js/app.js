function parseDate(str) {
  if (!str) return null;
  let s = String(str).trim();
  if (!s) return null;

  const mainPart = s.split('.')[0];
  const isoLike = mainPart.replace(' ', 'T');
  const d = new Date(isoLike);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normalizeStatus(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase();
}

function groupByDay(rows, dateFieldName) {
  const map = {};
  for (const r of rows) {
    const d = r[dateFieldName];
    if (!d) continue;
    const key =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    map[key] = (map[key] || 0) + 1;
  }
  const labels = Object.keys(map).sort();
  const values = labels.map((l) => map[l]);
  return { labels, values };
}

function groupHoursByDay(rows, startField, endField) {
  const map = {};
  for (const r of rows) {
    const start = r[startField];
    const end = r[endField];
    if (!start || !end) continue;

    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) continue;

    const hours = diffMs / 3_600_000;
    const d = start;
    const key =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    map[key] = (map[key] || 0) + hours;
  }
  const labels = Object.keys(map).sort();
  const values = labels.map((l) => map[l]);
  return { labels, values };
}

/* NUEVO: agrupado por franjas de 30 min (0, 0.5, 1, 1.5, ... 23.5)
   usando createdDate y statusNorm */
function buildHourlySuccessError(rows) {
  const BIN_COUNT = 24 * 2; // 48 bins de 30 minutos
  const labels = [];
  const success = new Array(BIN_COUNT).fill(0);
  const fails = new Array(BIN_COUNT).fill(0);

  for (let i = 0; i < BIN_COUNT; i++) {
    const hour = Math.floor(i / 2);
    const half = i % 2;
    labels.push(half ? `${hour}.5` : `${hour}`);
  }

  for (const r of rows) {
    const d = r.createdDate;
    if (!d) continue;

    const h = d.getHours();
    const m = d.getMinutes();
    let index = h * 2 + (m >= 30 ? 1 : 0);
    if (index < 0 || index >= BIN_COUNT) continue;

    const st = r.statusNorm || '';
    if (FINISHED_STATUSES.includes(st) || st.includes('success')) {
      success[index]++;
    } else if (st.includes('error') || st.includes('fail')) {
      fails[index]++;
    }
  }

  return { labels, success, fails };
}

function computeAnchorDate(rows) {
  let maxTime = null;
  for (const r of rows) {
    const candidates = [r.createdDate, r.completedDate, r.startDate, r.endDate];
    for (const d of candidates) {
      if (!d) continue;
      const t = d.getTime();
      if (maxTime === null || t > maxTime) maxTime = t;
    }
  }
  return maxTime !== null ? new Date(maxTime) : null;
}

function computeMinDate(rows) {
  let minTime = null;
  for (const r of rows) {
    const candidates = [r.createdDate, r.completedDate, r.startDate, r.endDate];
    for (const d of candidates) {
      if (!d) continue;
      const t = d.getTime();
      if (minTime === null || t < minTime) minTime = t;
    }
  }
  return minTime !== null ? new Date(minTime) : null;
}

function formatDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

let allRows = [];

const FINISHED_STATUSES = ['finished', 'completed', 'done', 'success'];

// Charts relativos
let createdChartRel = null;
let finishErrorChartRel = null;
let statusChartRel = null;
let hoursChartRel = null;

// Charts rango
let createdChartRange = null;
let finishErrorChartRange = null;
let statusChartRange = null;
let hoursChartRange = null;
let hourlyChartRange = null; // NUEVO

// DOM refs
const statusText = document.getElementById('statusText');

// Vista relativa
const kpiCreatedRel = document.getElementById('kpiCreatedRel');
const kpiFinishedRel = document.getElementById('kpiFinishedRel');
const kpiErrorRel = document.getElementById('kpiErrorRel');
const kpiAvgTimeRel = document.getElementById('kpiAvgTimeRel');
const kpiHoursRel = document.getElementById('kpiHoursRel');

// Vista rango
const kpiCreatedRange = document.getElementById('kpiCreatedRange');
const kpiFinishedRange = document.getElementById('kpiFinishedRange');
const kpiErrorRange = document.getElementById('kpiErrorRange');
const kpiAvgTimeRange = document.getElementById('kpiAvgTimeRange');
const kpiHoursRange = document.getElementById('kpiHoursRange');

// Controles
const timeRangeSelect = document.getElementById('timeRange');
const fileInput = document.getElementById('fileInput');
const loadBtn = document.getElementById('loadBtn');

const rangeFromInput = document.getElementById('rangeFrom');
const rangeToInput = document.getElementById('rangeTo');
const rangeModeSelect = document.getElementById('rangeMode');
const applyRangeBtn = document.getElementById('applyRangeBtn');

// ---------------------- Carga de CSV ----------------------

loadBtn.addEventListener('click', () => {
  const file = fileInput.files[0];
  if (!file) {
    alert('Seleccioná un archivo CSV primero.');
    return;
  }

  statusText.textContent = 'Procesando CSV...';

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rows = results.data;

      allRows = rows.map((r) => {
        const createdDate = parseDate(r.created);
        const completedDate = parseDate(r.completed);
        const startDate = parseDate(r.starttime);
        const endDate = parseDate(r.endtime);
        const statusNorm = normalizeStatus(r.status);
        return {
          ...r,
          createdDate,
          completedDate,
          startDate,
          endDate,
          statusNorm,
        };
      });

      statusText.textContent = `CSV cargado: ${rows.length} filas`;

      const minDate = computeMinDate(allRows);
      const maxDate = computeAnchorDate(allRows);
      if (minDate && maxDate) {
        rangeFromInput.value = formatDateTimeLocal(minDate);
        rangeToInput.value = formatDateTimeLocal(maxDate);
      }

      recalcRelative();
      recalcRange();
    },
    error: (err) => {
      console.error(err);
      statusText.textContent = 'Error al procesar el CSV';
    },
  });
});

// Eventos de filtros
timeRangeSelect.addEventListener('change', () => {
  if (!allRows.length) return;
  recalcRelative();
});

applyRangeBtn.addEventListener('click', () => {
  if (!allRows.length) {
    alert('Cargá un CSV primero.');
    return;
  }
  recalcRange();
});

rangeModeSelect.addEventListener('change', () => {
  if (!allRows.length) return;
  recalcRange();
});

// ---------------------- Vista relativa ----------------------

function recalcRelative() {
  if (!allRows.length) return;

  const minutesWindow = parseInt(timeRangeSelect.value, 10);
  const windowMs = minutesWindow * 60 * 1000;

  const anchor = computeAnchorDate(allRows);
  if (!anchor) {
    statusText.textContent = 'No se pudieron interpretar las fechas del CSV.';
    return;
  }

  const anchorTime = anchor.getTime();
  const fromTime = anchorTime - windowMs;

  const filteredByCreated = allRows.filter(
    (r) =>
      r.createdDate &&
      r.createdDate.getTime() >= fromTime &&
      r.createdDate.getTime() <= anchorTime
  );
  const filteredByCompleted = allRows.filter(
    (r) =>
      r.completedDate &&
      r.completedDate.getTime() >= fromTime &&
      r.completedDate.getTime() <= anchorTime
  );
  const filteredByStart = allRows.filter(
    (r) =>
      r.startDate &&
      r.startDate.getTime() >= fromTime &&
      r.startDate.getTime() <= anchorTime
  );

  const totalCreated = filteredByCreated.length;
  kpiCreatedRel.textContent = totalCreated;

  let finishedCount = 0;
  let errorCount = 0;
  let otherCount = 0;

  const statusCounts = {};
  let totalProcessingMinutes = 0;
  let processingCount = 0;

  for (const r of filteredByCompleted) {
    const st = r.statusNorm || 'desconocido';
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    if (FINISHED_STATUSES.includes(st) || st.includes('success')) {
      finishedCount++;
    } else if (st.includes('error') || st.includes('fail')) {
      errorCount++;
    } else {
      otherCount++;
    }

    if (r.createdDate && r.completedDate) {
      const diffMs = r.completedDate.getTime() - r.createdDate.getTime();
      const diffMin = diffMs / 60000;
      if (diffMin >= 0 && isFinite(diffMin)) {
        totalProcessingMinutes += diffMin;
        processingCount++;
      }
    }
  }

  kpiFinishedRel.textContent = finishedCount;
  kpiErrorRel.textContent = errorCount;

  if (processingCount > 0) {
    const avg = totalProcessingMinutes / processingCount;
    kpiAvgTimeRel.textContent = avg.toFixed(1) + ' min';
  } else {
    kpiAvgTimeRel.textContent = '–';
  }

  let totalHours = 0;
  for (const r of filteredByStart) {
    if (!r.startDate || !r.endDate) continue;
    const diffMs = r.endDate.getTime() - r.startDate.getTime();
    if (diffMs <= 0) continue;
    totalHours += diffMs / 3_600_000;
  }
  kpiHoursRel.textContent = totalHours > 0 ? totalHours.toFixed(1) + ' h' : '–';

  statusText.textContent =
    `Vista relativa: ventana ${minutesWindow} minutos · anchor = ` +
    anchor.toISOString().slice(0, 19).replace('T', ' ');

  const createdByDay = groupByDay(filteredByCreated, 'createdDate');
  const createdCtx = document.getElementById('createdChartRel').getContext('2d');
  if (createdChartRel) createdChartRel.destroy();
  createdChartRel = new Chart(createdCtx, {
    type: 'line',
    data: {
      labels: createdByDay.labels,
      datasets: [
        {
          label: 'Casos creados',
          data: createdByDay.values,
          tension: 0.25,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.18)',
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: baseLineOptions(),
  });

  const finishErrorCtx = document
    .getElementById('finishErrorChartRel')
    .getContext('2d');
  if (finishErrorChartRel) finishErrorChartRel.destroy();
  finishErrorChartRel = new Chart(finishErrorCtx, {
    type: 'bar',
    data: {
      labels: ['Finalizados OK', 'Con error', 'Otros'],
      datasets: [
        {
          label: 'Cantidad',
          data: [finishedCount, errorCount, otherCount],
          borderWidth: 1,
        },
      ],
    },
    options: baseBarOptions(),
  });

  const statusCtx = document.getElementById('statusChartRel').getContext('2d');
  if (statusChartRel) statusChartRel.destroy();
  const statusLabels = Object.keys(statusCounts);
  const statusValues = statusLabels.map((k) => statusCounts[k]);
  statusChartRel = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: statusLabels,
      datasets: [
        {
          data: statusValues,
        },
      ],
    },
    options: baseDoughnutOptions(),
  });

  const hoursByDay = groupHoursByDay(filteredByStart, 'startDate', 'endDate');
  const hoursCtx = document.getElementById('hoursChartRel').getContext('2d');
  if (hoursChartRel) hoursChartRel.destroy();
  hoursChartRel = new Chart(hoursCtx, {
    type: 'line',
    data: {
      labels: hoursByDay.labels,
      datasets: [
        {
          label: 'Horas procesadas',
          data: hoursByDay.values.map((v) => Number(v.toFixed(2))),
          tension: 0.25,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.18)',
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: baseLineOptions(),
  });
}

// ---------------------- Vista rango ----------------------

function recalcRange() {
  if (!allRows.length) return;

  const fromVal = rangeFromInput.value;
  const toVal = rangeToInput.value;

  if (!fromVal || !toVal) {
    kpiCreatedRange.textContent = '–';
    kpiFinishedRange.textContent = '–';
    kpiErrorRange.textContent = '–';
    kpiAvgTimeRange.textContent = '–';
    kpiHoursRange.textContent = '–';
    return;
  }

  const fromDate = new Date(fromVal);
  const toDate = new Date(toVal);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    alert('Rango de fechas inválido.');
    return;
  }

  let fromTime = fromDate.getTime();
  let toTime = toDate.getTime();

  if (fromTime > toTime) {
    alert('La fecha "Desde" no puede ser mayor que "Hasta".');
    return;
  }

  const mode = rangeModeSelect.value;
  if (mode !== 'all') {
    const minutes = parseInt(mode, 10);
    const windowMs = minutes * 60 * 1000;
    const fromWindow = toTime - windowMs;
    fromTime = Math.max(fromTime, fromWindow);
  }

  const filteredByCreated = allRows.filter(
    (r) =>
      r.createdDate &&
      r.createdDate.getTime() >= fromTime &&
      r.createdDate.getTime() <= toTime
  );
  const filteredByCompleted = allRows.filter(
    (r) =>
      r.completedDate &&
      r.completedDate.getTime() >= fromTime &&
      r.completedDate.getTime() <= toTime
  );
  const filteredByStart = allRows.filter(
    (r) =>
      r.startDate &&
      r.startDate.getTime() >= fromTime &&
      r.startDate.getTime() <= toTime
  );

  const totalCreated = filteredByCreated.length;
  kpiCreatedRange.textContent = totalCreated;

  let finishedCount = 0;
  let errorCount = 0;
  let otherCount = 0;

  const statusCounts = {};
  let totalProcessingMinutes = 0;
  let processingCount = 0;

  for (const r of filteredByCompleted) {
    const st = r.statusNorm || 'desconocido';
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    if (FINISHED_STATUSES.includes(st) || st.includes('success')) {
      finishedCount++;
    } else if (st.includes('error') || st.includes('fail')) {
      errorCount++;
    } else {
      otherCount++;
    }

    if (r.createdDate && r.completedDate) {
      const diffMs = r.completedDate.getTime() - r.createdDate.getTime();
      const diffMin = diffMs / 60000;
      if (diffMin >= 0 && isFinite(diffMin)) {
        totalProcessingMinutes += diffMin;
        processingCount++;
      }
    }
  }

  kpiFinishedRange.textContent = finishedCount;
  kpiErrorRange.textContent = errorCount;

  if (processingCount > 0) {
    const avg = totalProcessingMinutes / processingCount;
    kpiAvgTimeRange.textContent = avg.toFixed(1) + ' min';
  } else {
    kpiAvgTimeRange.textContent = '–';
  }

  let totalHours = 0;
  for (const r of filteredByStart) {
    if (!r.startDate || !r.endDate) continue;
    const diffMs = r.endDate.getTime() - r.startDate.getTime();
    if (diffMs <= 0) continue;
    totalHours += diffMs / 3_600_000;
  }
  kpiHoursRange.textContent = totalHours > 0 ? totalHours.toFixed(1) + ' h' : '–';

  const createdByDay = groupByDay(filteredByCreated, 'createdDate');
  const createdCtx = document.getElementById('createdChartRange').getContext('2d');
  if (createdChartRange) createdChartRange.destroy();
  createdChartRange = new Chart(createdCtx, {
    type: 'line',
    data: {
      labels: createdByDay.labels,
      datasets: [
        {
          label: 'Casos creados',
          data: createdByDay.values,
          tension: 0.25,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.18)',
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: baseLineOptions(),
  });

  const finishErrorCtx = document
    .getElementById('finishErrorChartRange')
    .getContext('2d');
  if (finishErrorChartRange) finishErrorChartRange.destroy();
  finishErrorChartRange = new Chart(finishErrorCtx, {
    type: 'bar',
    data: {
      labels: ['Finalizados OK', 'Con error', 'Otros'],
      datasets: [
        {
          label: 'Cantidad',
          data: [finishedCount, errorCount, otherCount],
          borderWidth: 1,
        },
      ],
    },
    options: baseBarOptions(),
  });

  const statusCtx = document.getElementById('statusChartRange').getContext('2d');
  if (statusChartRange) statusChartRange.destroy();
  const statusLabels = Object.keys(statusCounts);
  const statusValues = statusLabels.map((k) => statusCounts[k]);
  statusChartRange = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: statusLabels,
      datasets: [
        {
          data: statusValues,
        },
      ],
    },
    options: baseDoughnutOptions(),
  });

  const hoursByDay = groupHoursByDay(filteredByStart, 'startDate', 'endDate');
  const hoursCtx = document.getElementById('hoursChartRange').getContext('2d');
  if (hoursChartRange) hoursChartRange.destroy();
  hoursChartRange = new Chart(hoursCtx, {
    type: 'line',
    data: {
      labels: hoursByDay.labels,
      datasets: [
        {
          label: 'Horas procesadas',
          data: hoursByDay.values.map((v) => Number(v.toFixed(2))),
          tension: 0.25,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.18)',
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: baseLineOptions(),
  });

  
  const hourlyData = buildHourlySuccessError(filteredByCreated);
  const hourlyCtx = document.getElementById('hourlyChartRange').getContext('2d');
  if (hourlyChartRange) hourlyChartRange.destroy();
  hourlyChartRange = new Chart(hourlyCtx, {
    type: 'bar',
    data: {
      labels: hourlyData.labels,
      datasets: [
        {
          label: 'Cantidad de terminados',
          data: hourlyData.success,
          stack: 'stack1',
          backgroundColor: 'rgba(34,197,94,0.85)',
        },
        {
          label: 'Cantidad de fallas',
          data: hourlyData.fails,
          stack: 'stack1',
          backgroundColor: 'rgba(239,68,68,0.9)',
        },
      ],
    },
    options: baseBarOptions(true),
  });
}

// ---------------------- Config base de gráficos ----------------------

function baseLineOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: '#9ca3af' },
        grid: { color: 'rgba(148,163,184,0.15)' },
      },
      y: {
        ticks: { color: '#9ca3af' },
        grid: { color: 'rgba(148,163,184,0.12)' },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb',
          font: { size: 10 },
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
  };
}

function baseBarOptions(stacked = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked,
        ticks: { color: '#9ca3af' },
        grid: { color: 'rgba(148,163,184,0.1)' },
      },
      y: {
        stacked,
        ticks: { color: '#9ca3af' },
        grid: { color: 'rgba(148,163,184,0.12)' },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb',
          font: { size: 10 },
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
  };
}

function baseDoughnutOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#e5e7eb',
          font: { size: 10 },
        },
      },
    },
  };
}