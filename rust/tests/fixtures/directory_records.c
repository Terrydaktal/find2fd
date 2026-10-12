#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
long syscall(long number, ...) {
  void *saved = __builtin_apply_args();
  long (*real)(long,...) = dlsym(RTLD_NEXT,"syscall");
  if (number != SYS_getdents64 || getenv("FIND2FD_DIRENT_DISABLE")) {
    void *result = __builtin_apply((void (*)())real,saved,16);
    __builtin_return(result);
  }
  va_list args; va_start(args,number);
  int fd = va_arg(args,int); void *buffer = va_arg(args,void *); size_t capacity = va_arg(args,size_t);
  va_end(args);
  long length = real(number,fd,buffer,capacity);
  if (length <= 0) return length;
  unsigned char *bytes = buffer;
  const char *fault = getenv("FIND2FD_DIRENT_FAULT");
  size_t cursor = 0, records = 0;
  while (cursor + 19 < (size_t)length) {
    uint16_t width; memcpy(&width,bytes+cursor+16,sizeof(width));
    if (width < 20 || width > (size_t)length-cursor) _exit(131);
    const char *name = (const char *)(bytes+cursor+19);
    if (strcmp(name,".") && strcmp(name,"..")) {
      records++;
      bytes[cursor+18] = 0; /* DT_UNKNOWN forces the actual anchored fstatat path. */
      if (fault && !strcmp(fault,"zero-inode") && !strcmp(name,"ZERO_INODE_TEST")) {
        memset(bytes+cursor,0,8);
        if (unlinkat(fd,name,0)) _exit(135);
      }
      if (fault && !strcmp(fault,"zero-length")) { memset(bytes+cursor+16,0,2); break; }
      if (fault && !strcmp(fault,"missing-NUL")) { memset(bytes+cursor+19,'x',width-19); break; }
    }
    cursor += width;
  }
  const char *events = getenv("FIND2FD_DIRENT_MARKER");
  if (!events) _exit(132);
  int output = open(events,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  if (output < 0) _exit(133);
  const char *event = records ? "changed non-dot records\n" : "empty batch\n";
  if (write(output,event,strlen(event)) != (ssize_t)strlen(event)) _exit(134);
  close(output);
  return fault && !strcmp(fault,"short-header") ? 1 : length;
}
