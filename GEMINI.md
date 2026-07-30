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
 - **Käytä oikeaa mergeä, älä squashia:** Aiemmat synkronoinnit tehtiin squash-mergenä, jolloin `git merge-base master upstream/master` jäi vanhaksi ja seuraava synkronointi näytti 83 committia jäljessä, vaikka sisältö oli jo pääosin mukana. Tämä tuotti kymmeniä turhia konflikteja. Mergeä `upstream/master` aidolla merge-commitilla, jotta merge-base pysyy ajan tasalla.

8. Migraatioiden versiointi (kriittinen sudenkuoppa)
 - Migraatio ajetaan vain jos sen versio on **suurempi** kuin tietokantaan tallennettu versio (`cmd/upgrade.go`, `semver.Compare`). Lista `migList` on oltava aidosti nouseva.
 - Tämä forkki käyttää omia migraatioversioita (`v6.3.0`, `v6.4.0`, `v6.5.0`) upstreamin versioiden rinnalla. Siitä seuraa kaksi riskiä:
   1. **Hiljaa ohittuva migraatio:** Jos upstream lisää uusia lauseita *vanhaan* migraatioon (esim. `v6.2.0`), ne eivät koskaan aja meidän kannassamme, koska kanta on jo versiossa `v6.4.0`. Tällöin lauseet on kopioitava uuteen forkki-migraatioon (näin tehtiin `v6.5.0`:ssa).
   2. **Versiotörmäys:** Jos upstream julkaisee joskus oman `v6.3.0`:n, se törmää meidän omaamme. Tarkista tämä jokaisessa synkronoinnissa.
 - **Tarkistus jokaisen synkronoinnin yhteydessä:** `git diff <edellinen-sync>..upstream/master -- internal/migrations/` — jos upstream on muokannut jo ajettua migraatiota, siirrä muutokset uuteen forkki-migraatioon.
 - Huom: `cmd`-paketti ei voi sisältää testejä, koska `main.go`:n `init()` lopettaa prosessin ilman `config.toml`-tiedostoa. `migList`-järjestystä ei siksi voi yksikkötestata nykyisellään.

Kun PR on tehty, käy tarkistamassa siihen tulleet kommentit ja implementoi niissä mainitut korjaukset tarpeen mukaan ennen mergeä.
