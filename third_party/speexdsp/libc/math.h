/* Sonora Live: the math the echo canceller needs. sqrt, fabs and floor are WebAssembly instructions; the others
   are imported from JavaScript (Math.*), used when the state is created and, for exp, rarely. */
#ifndef SONORA_MATH_H
#define SONORA_MATH_H
#define M_PI 3.14159265358979323846
double cos(double);
double sin(double);
double exp(double);
double log(double);
double pow(double, double);
double atan(double);
#define sqrt(x) __builtin_sqrt(x)
#define fabs(x) __builtin_fabs(x)
#define floor(x) __builtin_floor(x)
#endif
