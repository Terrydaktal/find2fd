import os,subprocess,sys
readfd,writefd=os.pipe2(os.O_CLOEXEC | (os.O_NONBLOCK if sys.argv[2]=='nonblocking-full-pipe' else 0))
if sys.argv[2]=='ignored-SIGPIPE':
    os.close(readfd)
else:
    try:
        while True: os.write(writefd,b'x'*4096)
    except BlockingIOError:
        pass
child=subprocess.Popen(['find',*sys.argv[3:]],executable=sys.argv[1],stdin=subprocess.DEVNULL,stdout=writefd,stderr=subprocess.PIPE,restore_signals=False)
_,errors=child.communicate(timeout=5)
os.close(writefd)
if sys.argv[2]!='ignored-SIGPIPE': os.close(readfd)
sys.stderr.buffer.write(errors)
sys.stderr.buffer.flush()
sys.exit(128-child.returncode if child.returncode<0 else child.returncode)
