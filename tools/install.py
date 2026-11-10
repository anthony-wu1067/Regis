import os, zipfile, shutil, json
APP = 'C:/Users/godsp/Downloads/Regis-app'
NEW = 'C:/Users/godsp/Downloads/Regis-project/desktop'
BAK = 'C:/Users/godsp/Downloads/Regis-project/release/backup-installed-' + json.load(open(APP + '/package.json', encoding='utf-8')).get('version', 'unknown') + '.zip'
KEEP_TOP = {'node_modules', 'setup-log.txt', 'package-lock.json'}

# 1) backup everything except node_modules
n = 0
with zipfile.ZipFile(BAK, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, ds, fs in os.walk(APP):
        ds[:] = [x for x in ds if x != 'node_modules']
        for f in fs:
            p = os.path.join(d, f); z.write(p, os.path.relpath(p, APP).replace(os.sep, '/')); n += 1
print('backed up', n, 'files')

# 2) package.json: new version and scripts, but keep the installed Electron (castlabs) dependency
old = json.load(open(APP + '/package.json', encoding='utf-8'))
new = json.load(open(NEW + '/package.json', encoding='utf-8'))
ev = (old.get('devDependencies') or {}).get('electron')
if ev: new.setdefault('devDependencies', {})['electron'] = ev
open(APP + '/package.json', 'w', encoding='utf-8').write(json.dumps(new, indent=2) + '\n')
print('package.json version', new['version'], 'electron', new['devDependencies'].get('electron'))

# 3) copy the new app files over (not node_modules, not test files, not package.json)
c = 0
for d, ds, fs in os.walk(NEW):
    ds[:] = [x for x in ds if x != 'node_modules']
    for f in fs:
        src = os.path.join(d, f); rel = os.path.relpath(src, NEW).replace(os.sep, '/')
        if rel.split('/')[0] in KEEP_TOP or rel == 'package.json': continue
        dst = os.path.join(APP, rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst); c += 1
print('copied', c, 'files')
