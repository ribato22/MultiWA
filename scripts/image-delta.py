#!/usr/bin/env python3
"""Per-layer delta of two `docker save` tars, so a deploy over a slow link downloads megabytes, not gigabytes.

  image-delta.py make  OLD.tar[.gz] NEW.tar[.gz] OUTDIR   (CI: both builds are at hand)
  image-delta.py apply OLD.tar[.gz] DELTADIR  OUT.tar      (anywhere that has the OLD tar)
  image-delta.py selftest                                  (round trip on two tiny fake images)

Layers of both images are paired by position (same Dockerfile, same layer order). A layer whose digest is
unchanged is copied from the old tar; a changed one is shipped as `zstd --patch-from=<old layer>` (a rebuilt
layer differs mostly in file mtimes and a few packages, so the patch is tiny); the small JSON members travel
verbatim. The outer tar headers are stored raw, so `apply` rebuilds the NEW tar BYTE FOR BYTE and checks its
sha256 against the one recorded from the real artifact. Needs python3 and zstd >= 1.4 (a layer is under 2 GB).
"""
import base64, gzip, hashlib, io, json, os, shutil, subprocess, sys, tarfile, tempfile, time

BLOCK = 512
LEVEL = os.environ.get('DELTA_LEVEL', '15')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def raw_tar(path, workdir, tag):
    """A path to the uncompressed tar (gunzip into workdir when it is a .gz). `tag` keeps the two
    inputs apart: both artifacts are usually named multiwa-api-wagw.tar.gz."""
    if not path.endswith('.gz'):
        return path
    out = os.path.join(workdir, f'{tag}-' + os.path.basename(path)[:-3])
    with gzip.open(path, 'rb') as src, open(out, 'wb') as dst:
        shutil.copyfileobj(src, dst, 8 << 20)
    return out


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def layers_of(t):
    return json.load(t.extractfile('manifest.json'))[0]['Layers']


def extract_member(t, name, dest):
    with t.extractfile(name) as src, open(dest, 'wb') as dst:
        shutil.copyfileobj(src, dst, 8 << 20)


def make(old_path, new_path, outdir):
    os.makedirs(os.path.join(outdir, 'patches'), exist_ok=True)
    work = tempfile.mkdtemp(prefix='delta-')
    try:
        old_raw = raw_tar(old_path, work, 'old'); log('old tar', os.path.getsize(old_raw), 'bytes')
        new_raw = raw_tar(new_path, work, 'new'); log('new tar', os.path.getsize(new_raw), 'bytes')
        old_sha, new_sha = sha256_file(old_raw), sha256_file(new_raw)
        if old_sha == new_sha:
            sys.exit('the OLD and NEW tars are identical: nothing to ship (and probably the wrong inputs)')
        to, tn = tarfile.open(old_raw), tarfile.open(new_raw)
        lo, ln = layers_of(to), layers_of(tn)
        pair = dict(zip(ln, lo)) if len(lo) == len(ln) else {}
        log('layers: old', len(lo), 'new', len(ln), '(paired)' if pair else '(NOT paired: everything literal)')
        members, shipped = [], 0
        end_of_data = 0
        with open(new_raw, 'rb') as new_data:
            for ti in tn.getmembers():
                new_data.seek(ti.offset)
                header = new_data.read(ti.offset_data - ti.offset)
                m = {'name': ti.name, 'hdr': base64.b64encode(header).decode(), 'size': ti.size, 'kind': 'none'}
                if ti.isfile() and ti.size > 0:
                    if ti.name in pair:
                        old_name = pair[ti.name]
                        if old_name == ti.name:
                            m.update(kind='copy', old=old_name)
                        else:
                            a, b = os.path.join(work, 'layer.old'), os.path.join(work, 'layer.new')
                            extract_member(to, old_name, a); extract_member(tn, ti.name, b)
                            pname = os.path.basename(ti.name) + '.zst'
                            t0 = time.time()
                            subprocess.run(['zstd', '-T0', f'-{LEVEL}', '--long=31', f'--patch-from={a}', b, '-o',
                                            os.path.join(outdir, 'patches', pname), '-f', '-q'], check=True)
                            psize = os.path.getsize(os.path.join(outdir, 'patches', pname))
                            shipped += psize
                            log(f'layer {os.path.basename(ti.name)[:12]} {ti.size/1048576:8.1f} MiB -> patch {psize/1048576:7.2f} MiB ({time.time()-t0:.0f}s)')
                            m.update(kind='patch', old=old_name, patch=pname)
                            os.remove(a); os.remove(b)
                    else:
                        new_data.seek(ti.offset_data)
                        m.update(kind='literal', lit=base64.b64encode(new_data.read(ti.size)).decode())
                        shipped += len(m['lit'])
                members.append(m)
                end_of_data = ti.offset_data + ti.size + (-ti.size) % BLOCK
            new_data.seek(end_of_data)
            tail = new_data.read()
        plan = {'version': 1, 'old_sha256': old_sha, 'new_sha256': new_sha, 'new_size': os.path.getsize(new_raw),
                'members': members, 'tail': base64.b64encode(tail).decode()}
        with open(os.path.join(outdir, 'plan.json'), 'w') as f:
            json.dump(plan, f)
        log(f'DELTA READY: patches {shipped/1048576:.1f} MiB + plan; new sha256 {new_sha}')
        print(json.dumps({'old_sha256': old_sha, 'new_sha256': new_sha, 'new_size': plan['new_size']}))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def apply(old_path, deltadir, out_path):
    plan = json.load(open(os.path.join(deltadir, 'plan.json')))
    work = tempfile.mkdtemp(prefix='delta-')
    try:
        old_raw = raw_tar(old_path, work, 'old')
        got = sha256_file(old_raw)
        if got != plan['old_sha256']:
            sys.exit(f'the OLD tar is not the one this delta was made against\n  have {got}\n  want {plan["old_sha256"]}')
        log('old tar verified')
        to = tarfile.open(old_raw)
        h = hashlib.sha256()
        with open(out_path, 'wb') as out:
            def w(b):
                out.write(b); h.update(b)
            for m in plan['members']:
                w(base64.b64decode(m['hdr']))
                size, kind = m['size'], m['kind']
                if kind == 'literal':
                    w(base64.b64decode(m['lit']))
                elif kind == 'copy':
                    with to.extractfile(m['old']) as src:
                        for chunk in iter(lambda: src.read(8 << 20), b''):
                            w(chunk)
                elif kind == 'patch':
                    a, b = os.path.join(work, 'layer.old'), os.path.join(work, 'layer.new')
                    extract_member(to, m['old'], a)
                    subprocess.run(['zstd', '-d', '--long=31', f'--patch-from={a}', os.path.join(deltadir, 'patches', m['patch']),
                                    '-o', b, '-f', '-q'], check=True)
                    with open(b, 'rb') as src:
                        for chunk in iter(lambda: src.read(8 << 20), b''):
                            w(chunk)
                    os.remove(a); os.remove(b)
                if kind != 'none':
                    w(b'\0' * ((-size) % BLOCK))
            w(base64.b64decode(plan['tail']))
        ok = h.hexdigest() == plan['new_sha256'] and os.path.getsize(out_path) == plan['new_size']
        log('REBUILT', out_path, 'sha256', h.hexdigest(), 'MATCHES the real artifact' if ok else 'DOES NOT MATCH')
        sys.exit(0 if ok else 1)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def selftest():
    """Two tiny fake images (one layer unchanged, one changed): make + apply must rebuild the new tar exactly."""
    def add(t, name, data):
        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = 0
        t.addfile(ti, io.BytesIO(data))

    def layer(files):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w') as t:
            for name, data in files.items():
                add(t, name, data)
        return buf.getvalue()

    def image(path, layers):  # layer names are content digests, like in a real `docker save`
        names = ['blobs/sha256/' + hashlib.sha256(b).hexdigest() for b in layers]
        with tarfile.open(path, 'w') as t:
            add(t, 'manifest.json', json.dumps([{'Layers': names}]).encode())
            for name, data in zip(names, layers):
                add(t, name, data)

    with tempfile.TemporaryDirectory() as d:
        old, new, out, rebuilt = (os.path.join(d, n) for n in ('old.tar', 'new.tar', 'out', 'rebuilt.tar'))
        same, big = layer({'f': os.urandom(5000)}), os.urandom(300_000)
        image(old, [same, layer({'big': big, 'v': b'1'})])
        image(new, [same, layer({'big': big, 'v': b'2'})])
        make(old, new, out)
        kinds = sorted(m['kind'] for m in json.load(open(os.path.join(out, 'plan.json')))['members'])
        assert kinds == ['copy', 'literal', 'patch'], kinds
        try:
            apply(old, out, rebuilt)
        except SystemExit as e:
            assert e.code == 0, 'apply did not reproduce the new tar'
        assert open(rebuilt, 'rb').read() == open(new, 'rb').read()
    print('selftest OK')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == 'selftest':
        selftest()
    elif len(sys.argv) == 5 and sys.argv[1] == 'make':
        make(*sys.argv[2:5])
    elif len(sys.argv) == 5 and sys.argv[1] == 'apply':
        apply(*sys.argv[2:5])
    else:
        sys.exit(__doc__)
