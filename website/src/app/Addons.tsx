// Install links for the addons the site reads. Road to Sixty is the only
// one the site needs; the other two add detail, so they're shown smaller.
const ADDONS = {
  rts: { name: "Road to Sixty", url: "https://www.curseforge.com/wow/addons/road-to-sixty" },
  jf: { name: "Journey Forever", url: "https://www.curseforge.com/wow/addons/journey-forever" },
  jt: { name: "Journey Tracker", url: "https://www.curseforge.com/wow/addons/journey-tracker" },
};

function Out({ href, children }: { href: string; children: preact.ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// The full panel: home page when signed out, and the characters page before
// anything has been uploaded.
export function AddonsPanel() {
  return (
    <section class="addons" id="addons" aria-labelledby="addons-title">
      <div class="addons-head">
        <h2 id="addons-title">Addons you need</h2>
        <span class="small muted">Install them before you play. They record as you go and save when you log out.</span>
      </div>
      <div class="addon-grid">
        <article class="addon">
          <div class="addon-top">
            <h3>{ADDONS.rts.name}</h3>
            <span class="pill req">Required</span>
          </div>
          <p>Records your path on the map and the timeline of levels, deaths, quests and gold. Most of the site is built from it.</p>
          <span class="tiny muted">by Jordan Burch</span>
          <div class="addon-links">
            <Out href={ADDONS.rts.url}>Get it on CurseForge</Out>
          </div>
        </article>
        <div class="rec-col">
          <span class="rec-label">Recommended</span>
          <article class="addon compact">
            <div class="addon-name">
              <h3>{ADDONS.jf.name}</h3>
              <p>Screenshots of dungeon clears and epic loot, plus notes.</p>
            </div>
            <div class="addon-links">
              <Out href={ADDONS.jf.url}>CurseForge</Out>
            </div>
          </article>
          <article class="addon compact">
            <div class="addon-name">
              <h3>{ADDONS.jt.name}</h3>
              <p>Where your gold came from and went, and more kill detail.</p>
            </div>
            <div class="addon-links">
              <Out href={ADDONS.jt.url}>CurseForge</Out>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

// One line above the characters once the player has uploaded.
export function AddonsStrip() {
  return (
    <div class="addons-strip" aria-label="Addons">
      <span class="addons-strip-item">
        <b>{ADDONS.rts.name}</b>
        <span class="pill req">Required</span>
        <Out href={ADDONS.rts.url}>Get it on CurseForge</Out>
      </span>
      <span class="addons-strip-sep" aria-hidden="true">
        |
      </span>
      <span class="addons-strip-item tiny">
        <span class="muted">Recommended:</span>
        <Out href={ADDONS.jf.url}>{ADDONS.jf.name}</Out>
        <span class="muted" aria-hidden="true">
          ·
        </span>
        <Out href={ADDONS.jt.url}>{ADDONS.jt.name}</Out>
      </span>
    </div>
  );
}
