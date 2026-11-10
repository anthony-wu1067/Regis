import os, zipfile
root='C:/Users/godsp/Downloads/Regis-project'
skip_dirs={'node_modules','.claude','release','dist','.git'}
def walk(base):
    for d,ds,fs in os.walk(base):
        ds[:]=[x for x in ds if x not in skip_dirs]
        for f in fs:
            if not f.endswith('.log'): yield os.path.join(d,f)
rel=lambda p,b: os.path.relpath(p,b).replace(os.sep,'/')
ign={'desktop/renderer/index.html','desktop/renderer/sync.js','desktop/renderer/localdb.js'}
n=0
with zipfile.ZipFile(root+'/release/Regis-project.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in walk(root):
        r=rel(p,root)
        if r in ign: continue
        z.write(p,r); n+=1
print('Regis-project.zip',n,'files')
d=root+'/desktop'; n=0
with zipfile.ZipFile(root+'/release/Regis-app.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in walk(d):
        z.write(p,rel(p,d)); n+=1
print('Regis-app.zip',n,'files')
