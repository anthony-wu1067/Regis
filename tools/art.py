"""Puts the character and room pictures (tools/art/*.webp) into desktop/page/regis.html as embedded images.
Run it again after changing a picture:  py tools/art.py
The pictures go between the /*GOFART<*/ and /*>GOFART*/ markers at the end of the page's CSS."""
import base64, io, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
page = os.path.join(root, 'desktop', 'page', 'regis.html')
art = os.path.join(root, 'tools', 'art')
uri = lambda n: 'url(data:image/webp;base64,' + base64.b64encode(open(os.path.join(art, n), 'rb').read()).decode() + ')'
# picture size, then the face for round avatars: centre x, centre y (percent of the picture) and its width (share of the picture's width)
CH = {'exusiai': (294, 420, 57, 29, .66), 'midas': (264, 420, 47, 23, .74), 'luna': (242, 420, 45, 20.5, .76), 'obsidian': (252, 420, 54, 23, .80)}
out = []
for k, (w, h, cx, cy, sd) in CH.items():
    side = sd * w
    left = max(0, min(w - side, cx / 100 * w - side / 2)); top = max(0, min(h - side, cy / 100 * h - side / 2))
    out.append('.chb[data-chb="%s"] .chb-p,.chb-face[data-chb="%s"]{background-image:%s}' % (k, k, uri(k + '.webp')))
    out.append('.chb-face[data-chb="%s"]{background-size:%.1f%% auto;background-position:%.1f%% %.1f%%}' % (k, 100 / sd, left / (w - side) * 100, top / (h - side) * 100))
for i in range(5):
    out.append('.gof-rm[data-img="%d"],.gof-fg[data-img="%d"]{background-image:%s}' % (i, i, uri('room%d.webp' % i)))
s = io.open(page, encoding='utf8', newline='').read()
a, b = '/*GOFART<*/', '/*>GOFART*/'
i, j = s.index(a) + len(a), s.index(b)
s = s[:i] + '\n' + '\n'.join(out) + '\n' + s[j:]
io.open(page, 'w', encoding='utf8', newline='').write(s)
print('art embedded: %d KB of pictures, page is now %d KB' % (sum(len(x) for x in out) // 1024, len(s.encode('utf8')) // 1024))
