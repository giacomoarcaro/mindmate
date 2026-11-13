import { BRAND, drawLogoWide, leadUrl } from '../gym/brand';

export interface RoundResult {
  won: boolean;
  /** 1 = first; 0 = did not finish in time */
  place: number;
  racers: number;
  seconds: number;
  best: number | null;
  newBest: boolean;
  socios: number;
  puntos: number;
  hits: number;
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** A short, readable code the gym can match to a WhatsApp message. */
function prizeCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return `BJG-${s}`;
}

/**
 * Start screen, end-of-round screen and the lead form. The form does not send anything by
 * itself: it composes a WhatsApp message to the gym that the player sends from their phone.
 */
export class RoundScreens {
  private el: HTMLElement;
  onStart: () => void = () => undefined;
  onRestart: () => void = () => undefined;
  /** join a multiplayer room: 'quick' picks a public room, otherwise the given code */
  onJoin: (name: string, code: string | 'quick') => void = () => undefined;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'round';
    document.body.appendChild(this.el);
  }

  hide() { this.el.className = ''; this.el.innerHTML = ''; }
  get visible() { return this.el.classList.contains('show'); }

  showStart(rivals: string[], meters: number, best: number | null, touch: boolean, multiplayer = false, invite = '') {
    const logo = drawLogoWide(400).toDataURL();
    this.el.innerHTML = `
      <div class="rs-card">
        <img class="rs-logo" src="${logo}" alt="Jungle Gym Bacalar" />
        <h1>Carrera al Jungle Gym</h1>
        <p class="rs-lead">Desde la plaza de Bacalar hasta el gym: <b>${(meters / 1000).toFixed(1)} km</b> de calles reales. <b>Llega primero</b> y gana tu <b>primer día gratis</b>.</p>
        <ul class="rs-how">
          <li>Rivales: <b>${rivals.join(', ')}</b>. Sigue la línea verde del mapa o busca tu atajo.</li>
          <li>Termina en el círculo verde frente al gym. ${best ? `Tu récord: <b>${fmtTime(best)}</b>.` : ''}</li>
          <li>Bonus: recoge a quien pide <b>¡AL GYM!</b> y atropella al resto para sumar puntos.</li>
        </ul>
        <p class="rs-keys">${touch ? 'Palanca para girar · GAS y FRENO a la derecha' : 'WASD o flechas · Espacio freno de mano · C cámara · G claxon'}</p>
        <button class="rs-btn rs-primary" id="rs-start">${multiplayer ? 'Carrera contra bots' : '¡A jugar!'}</button>
        ${multiplayer ? `
        <form class="rs-form rs-mp" id="rs-mp">
          <p class="rs-form-title">${invite ? `Te invitaron a la sala ${esc(invite)}` : 'Jugar con amigos'}</p>
          <label for="rs-nick">Tu apodo</label>
          <input id="rs-nick" maxlength="14" placeholder="Ej. Mariana" autocomplete="nickname" />
          <div class="rs-row rs-mp-row">
            ${invite ? `<button class="rs-btn rs-wa" type="submit" data-mode="code">Entrar a la sala ${esc(invite)}</button>` : `
            <button class="rs-btn rs-wa" type="submit" data-mode="quick">Partida rápida</button>
            <button class="rs-btn rs-ghost" type="submit" data-mode="new">Crear sala</button>`}
          </div>
          <div class="rs-code-row">
            <input id="rs-room" maxlength="6" placeholder="Código" value="${esc(invite)}" autocapitalize="characters" />
            <button class="rs-btn rs-ghost" type="submit" data-mode="code">Entrar</button>
          </div>
          <small>Hasta 8 jugadores por sala. Solo se comparte tu apodo.</small>
        </form>` : ''}
      </div>`;
    this.el.className = 'show';
    this.el.querySelector('#rs-start')!.addEventListener('click', () => { this.hide(); this.onStart(); });
    const mp = this.el.querySelector<HTMLFormElement>('#rs-mp');
    if (mp) {
      const nick = mp.querySelector<HTMLInputElement>('#rs-nick')!;
      try { nick.value = localStorage.getItem('bjg-nick') ?? ''; } catch { /* storage unavailable */ }
      mp.addEventListener('submit', (e) => {
        e.preventDefault();
        const mode = ((e as SubmitEvent).submitter as HTMLElement | null)?.dataset.mode ?? 'quick';
        const name = nick.value.trim() || 'Jugador';
        try { localStorage.setItem('bjg-nick', name); } catch { /* storage unavailable */ }
        const typed = mp.querySelector<HTMLInputElement>('#rs-room')!.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (mode === 'code' && typed.length < 3) { mp.querySelector<HTMLInputElement>('#rs-room')!.focus(); return; }
        this.hide();
        this.onJoin(name, mode === 'quick' ? 'quick' : mode === 'new' ? '' : typed);
      });
    }
  }

  showEnd(r: RoundResult) {
    const code = prizeCode();
    const ord = ['', '1º', '2º', '3º', '4º', '5º'][r.place] ?? `${r.place}º`;
    const record = r.newBest ? '<span class="rs-best">¡Nuevo récord!</span>' : r.best ? `<span class="rs-sub">récord ${fmtTime(r.best)}</span>` : '';
    const head = r.won
      ? `<h1>¡Llegaste primero!</h1><p class="rs-lead">Tiempo <b>${fmtTime(r.seconds)}</b> ${record}<br>Tu premio: <b>${BRAND.offer.toLowerCase()}</b> en el Jungle Gym.</p>
         <div class="rs-code">Tu código <b>${code}</b></div>`
      : r.place > 0
        ? `<h1>Llegaste ${ord} de ${r.racers}</h1><p class="rs-lead">Tiempo <b>${fmtTime(r.seconds)}</b> ${record}<br>Casi. Igual puedes probar el gym: el primer día es gratis.</p>`
        : `<h1>¡Se acabó el tiempo!</h1><p class="rs-lead">No llegaste al gym a tiempo. Igual puedes probarlo: el primer día es gratis.</p>`;
    this.el.innerHTML = `
      <div class="rs-card rs-end">
        ${head}
        <div class="rs-stats"><div><b>${r.place > 0 ? ord : '-'}</b><span>posición</span></div><div><b>${r.place > 0 ? fmtTime(r.seconds) : '-'}</b><span>tiempo</span></div><div><b>${r.puntos.toLocaleString('es-MX')}</b><span>puntos</span></div><div><b>${r.socios}</b><span>llevaste</span></div></div>
        <form class="rs-form" id="rs-form" autocomplete="on">
          <p class="rs-form-title">${r.won ? 'Reclama tu día gratis por WhatsApp' : 'Reserva tu día gratis por WhatsApp'}</p>
          <label for="rs-name">Tu nombre</label>
          <input id="rs-name" name="name" required maxlength="40" placeholder="Ej. Mariana" />
          <label for="rs-goal">¿Qué quieres lograr?</label>
          <select id="rs-goal" name="goal">
            <option>Bajar de peso</option><option>Ganar músculo</option><option>Mejorar condición física</option>
            <option>Clases de HIIT o funcional</option><option>Entrenador personal</option>
          </select>
          <label for="rs-when">¿Cuándo te gustaría entrenar?</label>
          <select id="rs-when" name="when"><option>Mañana</option><option>Tarde</option><option>Noche</option></select>
          <button class="rs-btn rs-wa" type="submit">Enviar por WhatsApp</button>
          <small>Se abre WhatsApp con tu mensaje listo. El juego no guarda tus datos.</small>
        </form>
        <div class="rs-row">
          ${r.won ? '<a class="rs-btn rs-primary" href="https://bacalarjunglegym.com/" target="_blank" rel="noopener">Visita bacalarjunglegym.com</a>' : ''}
          <button class="rs-btn rs-ghost" id="rs-again">Jugar otra vez</button>
        </div>
      </div>`;
    this.el.className = 'show';
    document.exitPointerLock?.();
    const form = this.el.querySelector<HTMLFormElement>('#rs-form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      const lines = [
        `¡Hola Jungle Gym! Soy ${name}.`,
        r.won ? `Gané la carrera de Bacalar Drive al Jungle Gym en ${fmtTime(r.seconds)}. Mi código: ${code}.` : `Jugué la carrera de Bacalar Drive y quiero mi primer día gratis.`,
        `Quiero: ${fd.get('goal')}. Prefiero entrenar en la ${String(fd.get('when')).toLowerCase()}.`,
        '¿Cuándo puedo ir?',
      ];
      const url = leadUrl(lines.join('\n'));
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      const done = document.createElement('p');
      done.className = 'rs-sent';
      done.innerHTML = `Si WhatsApp no se abrió, toca aquí: <a href="${esc(url)}" target="_blank" rel="noopener">abrir WhatsApp</a>`;
      form.replaceWith(done);
    });
    this.el.querySelector('#rs-again')!.addEventListener('click', () => { this.hide(); this.onRestart(); });
  }
}
