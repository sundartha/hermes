import sys, json
path, phase_json = sys.argv[1], sys.argv[2]
src = open(path).read()
lines = src.split('\n')
idx = [i for i,l in enumerate(lines) if l.startswith('const PHASE = ')]
assert len(idx) == 1, idx
p = json.load(open(phase_json))
def js(v):
    return json.dumps(v, ensure_ascii=False)
own = '{ ' + ', '.join(f"{js(k)}: {js(v)}" for k,v in p['ownerRest'].items()) + ' }' if p['ownerRest'] else '{}'
lines[idx[0]] = ("const PHASE = { id: %s, titel: %s, ids: %s, branch: %s, dokumentFuerOpenAI: %s, notiz: %s, ownerRest: %s }"
  % (js(p['id']), js(p['titel']), js(p['ids']), js(p['branch']), 'true' if p['dok'] else 'false', js(p['notiz']), own))
vi = [i for i,l in enumerate(lines) if l.startswith('const VORGEBAUT = ')]
assert len(vi) == 1 and lines[vi[0]] == 'const VORGEBAUT = null', vi
open(path,'w').write('\n'.join(lines))
print('ok', idx[0]+1)
