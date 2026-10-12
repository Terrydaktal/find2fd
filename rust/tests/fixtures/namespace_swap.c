#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
static int matches(const char *path) {
  if (!path || getenv("FIND2FD_RACE_DISABLE")) return 0;
  const char *last = strrchr(path, '/');
  return strcmp(last ? last + 1 : path, "victim") == 0;
}
static void swap_before_open(const char *path) {
  if (!matches(path)) return;
  const char *marker = getenv("FIND2FD_RACE_MARKER");
  const char *victim = getenv("FIND2FD_RACE_VICTIM");
  const char *stash = getenv("FIND2FD_RACE_STASH");
  const char *outside = getenv("FIND2FD_RACE_OUTSIDE");
  if (!marker || !victim || !stash || !outside) _exit(121);
  int fd = syscall(SYS_openat, AT_FDCWD, marker, O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC, 0600);
  if (fd < 0) return;
  if (rename(victim, stash) || symlink(outside, victim)) _exit(122);
  const char done[] = "victim replaced immediately before directory open\n";
  if (write(fd, done, sizeof(done)-1) != sizeof(done)-1) _exit(123);
  close(fd);
}
static int mutant_flags(const char *path, int flags) {
  return matches(path) && getenv("FIND2FD_RACE_STRIP_NOFOLLOW") ? flags & ~O_NOFOLLOW : flags;
}
DIR *opendir(const char *path) {
  DIR *(*real)(const char *) = dlsym(RTLD_NEXT, "opendir");
  swap_before_open(path);
  return real(path);
}
int openat(int directory, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int (*real)(int,const char *,int,...) = dlsym(RTLD_NEXT, "openat");
  swap_before_open(path);
  return real(directory, path, mutant_flags(path, flags), mode);
}
int openat64(int directory, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int (*real)(int,const char *,int,...) = dlsym(RTLD_NEXT, "openat64");
  swap_before_open(path);
  return real(directory, path, mutant_flags(path, flags), mode);
}
