/* Sonora Live: allocation from one arena (the state is created once and dropped as a whole), no stdio. */
#ifndef OS_SUPPORT_CUSTOM_H
#define OS_SUPPORT_CUSTOM_H
void *sonora_calloc(unsigned long size);
#define OVERRIDE_SPEEX_ALLOC
static inline void *speex_alloc(int size) { return sonora_calloc((unsigned long)size); }
#define OVERRIDE_SPEEX_ALLOC_SCRATCH
static inline void *speex_alloc_scratch(int size) { return sonora_calloc((unsigned long)size); }
#define OVERRIDE_SPEEX_REALLOC
static inline void *speex_realloc(void *ptr, int size) { (void)ptr; return sonora_calloc((unsigned long)size); }
#define OVERRIDE_SPEEX_FREE
static inline void speex_free(void *ptr) { (void)ptr; }
#define OVERRIDE_SPEEX_FREE_SCRATCH
static inline void speex_free_scratch(void *ptr) { (void)ptr; }
#define OVERRIDE_SPEEX_FATAL
static inline void _speex_fatal(const char *str, const char *file, int line) { (void)str; (void)file; (void)line; __builtin_trap(); }
#define OVERRIDE_SPEEX_WARNING
static inline void speex_warning(const char *str) { (void)str; }
#define OVERRIDE_SPEEX_WARNING_INT
static inline void speex_warning_int(const char *str, int val) { (void)str; (void)val; }
#define OVERRIDE_SPEEX_NOTIFY
static inline void speex_notify(const char *str) { (void)str; }
#define OVERRIDE_SPEEX_PUTC
static inline void _speex_putc(int ch, void *file) { (void)ch; (void)file; }
#endif
