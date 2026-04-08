Workflow: PR-Based Development & Safety

Tämä projekti noudattaa tiukkaa PR-pohjaista (Pull Request) kehitysmallia vikasietoisuuden ja koodin laadun varmistamiseksi, vaikka kehittäjiä on vain yksi.

1. Haaroitus (Branching)
 - Kielto: Älä koskaan tee muutoksia tai committeja suoraan main-haaraan.
 - Käytäntö: Luo jokaiselle tehtävälle (feature, bug fix, refactor) uusi haara main-haarasta käsin.
 - Nimeäminen: Käytä etuliitteitä: feat/lyhyt-kuvaus, fix/bugin-nimi tai refactor/kohde.

2. Kehitys ja Validointi (Execution & Validation)
 - Nouda standardia Research -> Strategy -> Execution -sykliä.
 - Ennen commitointia, aja aina projektikohtaiset testit, linterit ja tyyppitarkistukset lokaalisti (uv run ruff check ., npm test, jne.).
 - Varmista, että kaikki muutokset ovat idiomaattisia ja noudattavat projektin tyyliä.

3. Commit ja Push
 - Tee atomisia ja selkeitä committeja, jotka kuvaavat muutoksen tarkoitusta.
 - Puskemisen jälkeen (push), agentin tulee raportoida onnistunut puskeminen ja antaa ohje PR:n avaamiseen (tai avata se, jos työkalut sallivat).

4. Pull Request (PR) ja Itsekatselmointi
 - PR-vaihe on kriittinen "viimeinen tarkistus" ennen koodin päätymistä staging-jonoon.
 - Status Checkit: CI:n (GitHub Actions) on mentävä läpi PR-haarassa ennen mergeä.
 - Squash Merge: Suosi "Squash and merge" -toimintoa, jotta main-haaran historia pysyy siistinä ja jokainen PR näkyy yhtenä kokonaisuutena.

5. Vikasietoisuuden tavoite
 - Main-eheys: main-haaran on oltava aina julkaisukelpoinen. Jos CI epäonnistuu PR-haarassa, main ei saastu.
 - Rollback-valmius: Koska käytössä on blue/green-julkaisu, jokaisen mergetyn PR:n on oltava helposti peruttavissa (git revert) ilman sivuvaikutuksia muihin ominaisuuksiin.

6. Editorin koskemattomuus (Editor Integrity)
 - Projektissa on tehty mittavia muutoksia editoriin (Tiptap-integraatio upstreamin TinyMCE:n sijaan).
 - **Kielto:** Älä koskaan ylikirjoita editoria upstreamin TinyMCE-pohjaisilla muutoksilla.
 - Kriittiset tiedostot ja kansiot:
   - `frontend/src/components/Editor.vue`
   - `frontend/src/components/RichtextEditor.vue`
   - `frontend/src/components/MarkdownEditor.vue`
   - `frontend/src/components/EmailMarkdownEditor.vue`
   - `frontend/src/components/VisualEditor.vue`
   - `frontend/src/components/CodeEditor.vue`
   - `frontend/email-builder/`

7. Upstream-synkronoinnin strategiat
 - **Manuaalinen konfliktointi:** Kun `upstream/master` mergetään, tarkista aina editoriin liittyvät tiedostot erikseen. Jos upstream tuo muutoksia editoriin, ratkaise konfliktit suosimalla paikallisia (ours) muutoksia editorin ydintoiminnallisuuden osalta.
 - **Cherry-pick -vaihtoehto:** Jos upstream-muutokset ovat massiivisia, harkitse vain kriittisten tietoturvakorjausten tai uusien ominaisuuksien cherry-pickaamista editoritiedostojen ulkopuolelta.
 - **Validointi:** Jokaisen synkronoinnin jälkeen varmista editorin toimivuus (sekä Tiptap että email-builder) ennen mergaamista main-haaraan.

Kun PR on tehty, käy tarkistamassa siihen tulleet kommentit ja implementoi niissä mainitut korjaukset tarpeen mukaan ennen mergeä.
