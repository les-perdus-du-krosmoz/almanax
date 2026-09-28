# Almanax Dofus 3

Site statique (GitHub Pages) qui affiche le bonus de l'Almanax au jour le jour, l'offrande à préparer, et une recherche par catégorie ou par offrande. Les données viennent de l'API communautaire [dofusdude](https://docs.dofusdu.de) et sont régénérées chaque nuit par une GitHub Action. Un post Discord quotidien est possible, en option.

## Structure

```
config/categories.json      id de bonus -> tags (à modifier sans toucher au code)
scripts/generate.py         récupère l'API, tague les jours, écrit les fichiers ci-dessous
docs/                       le site (index.html, style.css, app.js)
docs/data/almanax.json      généré : données lues par le site
reports/types_a_classer.md  généré : bonus en « Autre », avec leurs vraies descriptions
reports/coverage_log.csv    généré : date de fin des données, run après run
.github/workflows/          génération nocturne + déploiement Pages
```

## Mise en route

1. Crée un dépôt GitHub et pousse ce dossier sur la branche `main`.
2. **Settings → Pages → Source : GitHub Actions.**
3. **Actions → Almanax → Run workflow** pour la première génération. Le site est en ligne à la fin du run.
4. Optionnel, pour Discord :
   - secret `DISCORD_WEBHOOK_URL` (Settings → Secrets and variables → Actions → Secrets) : l'URL du webhook du salon ;
   - variable `SITE_URL` : l'adresse du site, pour que le post renvoie vers le bon jour ;
   - variable `WATCH_TAGS` : tags du bloc « À surveiller », par défaut `xp,butin,challenge,metier`.

## En local

```bash
python scripts/generate.py            # Python 3.9+, aucune dépendance
python -m http.server -d docs 8000    # puis http://localhost:8000
```

## Classer les bonus

Ouvre `reports/types_a_classer.md`, lis les descriptions, puis déplace chaque id de `a_classer` vers `types` dans `config/categories.json` avec ses tags. Un id inconnu (nouveau patch) apparaît aussi dans ce rapport.

## Points de vigilance

- **Horizon des données.** L'API ne couvre qu'environ 5,5 mois. `reports/coverage_log.csv` montre si la date de fin avance chaque jour ou par paliers.
- **Retards des crons GitHub.** Ils sont souvent de plusieurs minutes, parfois plus. Le post Discord n'arrive pas à minuit pile.
- **Inactivité.** GitHub peut désactiver les workflows planifiés d'un dépôt public inactif depuis 60 jours. Les commits quotidiens de l'Action devraient suffire à l'éviter ; si le workflow est désactivé, un bouton permet de le réactiver dans l'onglet Actions.
- **Pas de prix HDV.** Aucune API de prix n'existe, la rentabilité de l'offrande est donc hors périmètre.
