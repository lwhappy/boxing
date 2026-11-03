import{i as e}from"./actions-DcVXNM2C.js";var t=[{key:`x`,label:`Position`,min:-2.4,max:2.4,step:.01,unit:`m`},{key:`z`,label:`Side`,min:-1.5,max:1.5,step:.01,unit:`m`},{key:`yaw`,label:`Rotation`,min:-60,max:60,step:1,unit:`°`},{key:`scale`,label:`Scale`,min:.7,max:1.4,step:.01,unit:`×`}],n=e=>e.replace(/[&<>"]/g,e=>`&#${e.charCodeAt(0)};`),r=class{root;hooks;buttons=new Map;inputs=[];adjust;active=`idle`;stance=`idle`;constructor(r,i){this.root=r,this.hooks=i,r.innerHTML=`
      <div class="deck-row moves" role="group" aria-label="Black fighter actions">
        ${e.map(e=>`<button type="button" class="slab kind-${e.kind}" data-action="${e.id}" aria-keyshortcuts="${e.keyLabel}">
          <span class="key">${n(e.keyLabel)}</span><span class="label">${n(e.label)}</span></button>`).join(``)}
      </div>
      <div class="deck-row tools" role="group" aria-label="Footwork and setup">
        <button type="button" class="slab tool" data-step="-1" aria-keyshortcuts="ArrowLeft"><span class="key">←</span><span class="label">Step Back</span></button>
        <button type="button" class="slab tool" data-step="1" aria-keyshortcuts="ArrowRight"><span class="key">→</span><span class="label">Step In</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="robot" aria-pressed="true"><span class="label">Robot</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="reach" aria-pressed="true"><span class="label">Auto Reach</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="anchors" aria-pressed="true"><span class="label">Anchors</span></button>
        <button type="button" class="slab toggle" data-toggle="adjust" aria-pressed="false" aria-controls="adjust-panel"><span class="label">Adjust</span></button>
      </div>
      <div class="adjust" id="adjust-panel" hidden>
        ${[`black`,`red`].map(e=>`
          <fieldset class="adjust-side side-${e}">
            <legend>${e===`black`?`Black`:`Red`}</legend>
            ${t.map(t=>`<label class="adj">
              <span>${t.label}</span>
              <input type="range" data-side="${e}" data-key="${t.key}" min="${t.min}" max="${t.max}" step="${t.step}" />
              <output></output>
            </label>`).join(``)}
          </fieldset>`).join(``)}
        <button type="button" class="slab tool reset" data-reset><span class="label">Reset</span></button>
      </div>`,this.adjust=r.querySelector(`.adjust`);for(let e of r.querySelectorAll(`[data-action]`))this.buttons.set(e.dataset.action,e),e.addEventListener(`click`,()=>{i.press(),i.action(e.dataset.action),this.pulse(e)});for(let e of r.querySelectorAll(`[data-step]`))e.addEventListener(`click`,()=>{i.press(),i.step(Number(e.dataset.step)),this.pulse(e)});for(let e of r.querySelectorAll(`[data-toggle]`))e.addEventListener(`click`,()=>{i.press();let t=!e.classList.contains(`is-on`);e.classList.toggle(`is-on`,t),e.setAttribute(`aria-pressed`,String(t));let n=e.dataset.toggle;n===`adjust`?(this.adjust.hidden=!t,t&&this.sync()):i.toggle(n,t)});r.querySelector(`[data-reset]`).addEventListener(`click`,()=>{i.press(),i.reset(),this.sync()});for(let e of r.querySelectorAll(`input[type=range]`)){let n=e.dataset.side,r={...t.find(t=>t.key===e.dataset.key),side:n},a=e.parentElement.querySelector(`output`);this.inputs.push({s:r,input:e,out:a}),e.addEventListener(`input`,()=>{let t=Number(e.value);i.transform(n,{[r.key]:t}),a.textContent=this.format(r,t)})}window.addEventListener(`keydown`,t=>{if(t.repeat||t.ctrlKey||t.metaKey||t.altKey||t.target?.tagName===`INPUT`)return;let n=e.find(e=>e.key===t.code);if(n){i.press(),i.action(n.id),this.pulse(this.buttons.get(n.id)),t.preventDefault();return}(t.code===`ArrowLeft`||t.code===`KeyA`)&&(i.press(),i.step(-1),t.preventDefault()),(t.code===`ArrowRight`||t.code===`KeyD`)&&(i.press(),i.step(1),t.preventDefault())}),this.setActive(e[0])}format(e,t){return`${e.key===`yaw`?t.toFixed(0):t.toFixed(2)}${e.unit}`}pulse(e){e.classList.remove(`pressed`),e.offsetWidth,e.classList.add(`pressed`)}sync(){if(!this.adjust.hidden)for(let{s:e,input:t,out:n}of this.inputs){let r=this.hooks.read(e.side)[e.key];document.activeElement!==t&&(t.value=String(r)),n.textContent=this.format(e,r)}}setActive(e){e.kind===`stance`&&(this.stance=e.id),this.active=e.id;for(let[t,n]of this.buttons)n.classList.toggle(`is-running`,t===this.active&&e.kind!==`stance`),n.classList.toggle(`is-stance`,t===this.stance)}get element(){return this.root}};export{r as Controls};