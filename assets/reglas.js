/*
 * Reglas de reserve.thecubandiner.com. Son COPIA EXACTA de las de los dos Apps Script, que tienen la última palabra:
 *   - entregables/reservas-generales/reservas-generales.gs  (horario, anticipación, 30 días, noche especial)
 *   - entregables/reservas-salsa-night/reservas.gs           (horas de llegada y cierre de la Salsa Night)
 * Si se cambia una regla allá, se cambia aquí también y se corre: node pruebas/prueba-reglas.js
 * La página no ve el cupo (20 por media hora, 50 en la Salsa Night): eso lo decide el script y lo dice el correo.
 */
(function (root) {
  'use strict';
  var ZONA = 'America/New_York', HORA_MS = 3600000;

  var GENERAL = {
    form: 'https://docs.google.com/forms/d/e/1FAIpQLScyZtwpUAwnuP0tizdb9H4yU9CmuhzV1mzbZb7qDUFSHAJhnA/formResponse',
    respaldo: 'https://forms.gle/5Uurt7YtQeqe5u5W6',
    entry: { nombre: 'entry.1723956575', telefono: 'entry.1787520549', email: 'entry.1432432745', fecha: 'entry.1478516318',
             hora: 'entry.498461953', grupo: 'entry.558262599', notas: 'entry.1877659846', ofertas: 'entry.112878101' },
    maxGrupo: 10, minHorasAntes: 2, maxDiasAntes: 30,
    ultima: { 0: '8:00 PM', 1: '8:00 PM', 2: '8:00 PM', 3: '8:00 PM', 4: '8:00 PM', 5: '9:00 PM', 6: '9:00 PM' },
    cerrado: [],                                                   // feriados 'yyyy-MM-dd' (igual que CFG.cerrado)
    especiales: [{ fecha: '2026-10-17', desde: '5:00 PM', nombre: 'Salsa Night' }]
  };
  var SALSA = {
    form: 'https://docs.google.com/forms/d/e/1FAIpQLSeveIAwbFD_-OGpEmhtn1DwBcOJG0ISdXxGoNojI_zrQV-IMQ/formResponse',
    respaldo: 'https://forms.gle/uBb3cU6tdfDdL5tp6',
    entry: { nombre: 'entry.1278116304', telefono: 'entry.255068641', email: 'entry.20022778', grupo: 'entry.1510976846',
             hora: 'entry.1991535024', notas: 'entry.1466178033', ofertas: 'entry.339440139' },
    maxGrupo: 10,
    fecha: '2026-10-17',
    horas: ['6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM'],
    cierre: Date.parse('2026-10-17T21:00:00Z'),   // sáb 17-oct 5:00 PM EDT: el formulario se cierra solo
    fin: Date.parse('2026-10-18T02:00:00Z'),      // 10:00 PM EDT: después la página ya no muestra el evento
    lleno: false                                   // true si se llenan los 50 (el script cierra el formulario)
  };
  var OFERTAS = 'Yes, send me Cuban Diner news and offers by email or text. I can unsubscribe anytime.';
  var RE_TEL = /^\+?[0-9() .-]{10,20}$/;                          // la misma del formulario
  var RE_EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;   // la del script (el formulario acepta más)

  function hora(min) {
    var h = Math.floor(min / 60), mm = min % 60;
    return ((h + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + (h < 12 ? ' AM' : ' PM');
  }
  function minutos(h) {
    var x = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(h || '');
    if (!x) return -1;
    return (Number(x[1]) % 12 + (x[3] === 'PM' ? 12 : 0)) * 60 + Number(x[2]);
  }
  var HORAS = [];                                                  // 11:00 AM … 9:00 PM cada 30 min (opciones del formulario)
  for (var m = 11 * 60; m <= 21 * 60; m += 30) HORAS.push(hora(m));

  // ---- fecha y hora de Atlanta, con horario de verano
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric' });
    if (!fmt.formatToParts) fmt = null;
  } catch (e) { fmt = null; }
  /** Respaldo sin Intl: EE. UU., verano del 2.º domingo de marzo al 1.er domingo de noviembre (2:00 AM). */
  function offsetRegla(ms) {
    var y = new Date(ms).getUTCFullYear();
    var ini = Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 7);
    var fin = Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 6);
    return ms >= ini && ms < fin ? -240 : -300;
  }
  function partes(ms) {
    if (fmt) {
      var p = {};
      fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute };
    }
    var l = new Date(ms + offsetRegla(ms) * 60000);
    return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours(), mi: l.getUTCMinutes() };
  }
  function iso(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
  function hoy(ms) { var p = partes(ms); return iso(p.y, p.m, p.d); }
  function sumarDias(fecha, n) {
    var f = fecha.split('-'), d = new Date(Date.UTC(+f[0], +f[1] - 1, +f[2] + n));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function diaSemana(fecha) { return new Date(fecha + 'T12:00:00Z').getUTCDay(); }
  /** Instante real de una fecha y hora de Atlanta (lo mismo que Utilities.parseDate del script). */
  function instante(fecha, h) {
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || ''), min = minutos(h);
    if (!f || min < 0) return NaN;
    var ingenuo = Date.UTC(+f[1], +f[2] - 1, +f[3], 0, min), t = ingenuo + 4 * HORA_MS, p = partes(t);
    return t + (ingenuo - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi));
  }

  /** Lo mismo que validar_() del script: 'ok' | 'pasado' | 'pronto' | 'lejos' | 'horario' | 'cerrado' | 'especial' | 'invalido'. */
  function estado(fecha, h, ahora) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || HORAS.indexOf(h) === -1) return 'invalido';
    var cuando = instante(fecha, h), dow = diaSemana(fecha);
    if (GENERAL.cerrado.indexOf(fecha) !== -1) return 'cerrado';
    if (minutos(h) > minutos(GENERAL.ultima[dow])) return 'horario';
    for (var i = 0; i < GENERAL.especiales.length; i++) {
      var x = GENERAL.especiales[i];
      if (x.fecha === fecha && minutos(h) >= minutos(x.desde)) return 'especial';
    }
    var dif = cuando - ahora;
    if (dif < 0) return 'pasado';
    if (dif < GENERAL.minHorasAntes * HORA_MS) return 'pronto';
    if (dif > GENERAL.maxDiasAntes * 24 * HORA_MS) return 'lejos';
    return 'ok';
  }
  /** Días que se ofrecen (hoy en Atlanta … 30 días): solo los que tienen alguna hora 'ok'. */
  function dias(ahora) {
    var out = [], base = hoy(ahora);
    for (var i = 0; i <= GENERAL.maxDiasAntes; i++) {
      var f = sumarDias(base, i), horas = HORAS.filter(function (h) { return estado(f, h, ahora) === 'ok'; });
      if (!horas.length) continue;
      var esp = GENERAL.especiales.filter(function (x) { return x.fecha === f; })[0] || null;
      out.push({ fecha: f, dow: diaSemana(f), horas: horas, especial: esp, indice: i });
    }
    return out;
  }
  function salsa(ahora) { return { visible: ahora < SALSA.fin, abierta: ahora < SALSA.cierre && !SALSA.lleno }; }

  /** '' si está bien; si no, el mensaje para el cliente. */
  function revisarContacto(d) {
    var tel = String(d.telefono || '').trim();
    if (String(d.nombre || '').trim().length < 2) return 'Please enter your full name.';
    if (!RE_TEL.test(tel) || tel.replace(/\D/g, '').length < 10) return 'Please enter a valid mobile number (10 digits).';
    if (!RE_EMAIL.test(String(d.email || '').trim())) return 'Please enter a valid email.';
    return '';
  }
  function grupoValido(g, max) { var n = Number(g); return n >= 1 && n <= max && Math.floor(n) === n; }
  function comunes(e, d, b) {
    b.push([e.nombre, String(d.nombre).trim().slice(0, 80)], [e.telefono, String(d.telefono).trim()],
      [e.email, String(d.email).trim()]);
  }
  function cierre(e, d, b) {
    var notas = String(d.notas || '').trim().slice(0, 300);
    if (notas) b.push([e.notas, notas]);
    if (d.ofertas) b.push([e.ofertas, OFERTAS]);
    b.push(['fvv', '1'], ['pageHistory', '0']);
    return b;
  }
  /** Lo que se manda al formulario de reservas generales: [[campo, valor], …]. */
  function envioGeneral(d) {
    var e = GENERAL.entry, f = String(d.fecha).split('-'), b = [];
    comunes(e, d, b);
    b.push([e.fecha + '_year', f[0]], [e.fecha + '_month', String(Number(f[1]))], [e.fecha + '_day', String(Number(f[2]))],
      [e.hora, d.hora], [e.grupo, String(d.grupo)]);
    return cierre(e, d, b);
  }
  /** Lo que se manda al formulario de la Salsa Night. */
  function envioSalsa(d) {
    var e = SALSA.entry, b = [];
    comunes(e, d, b);
    b.push([e.grupo, String(d.grupo)], [e.hora, d.hora]);
    return cierre(e, d, b);
  }

  var API = { GENERAL: GENERAL, SALSA: SALSA, OFERTAS: OFERTAS, HORAS: HORAS, RE_TEL: RE_TEL, RE_EMAIL: RE_EMAIL,
    hora: hora, minutos: minutos, partes: partes, offsetRegla: offsetRegla, hoy: hoy, sumarDias: sumarDias,
    diaSemana: diaSemana, instante: instante, estado: estado, dias: dias, salsa: salsa, revisarContacto: revisarContacto,
    grupoValido: grupoValido, envioGeneral: envioGeneral, envioSalsa: envioSalsa };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Reglas = API;
})(typeof window !== 'undefined' ? window : globalThis);
