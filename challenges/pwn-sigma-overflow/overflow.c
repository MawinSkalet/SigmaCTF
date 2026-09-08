// INTENTIONALLY VULNERABLE x86-64 ret2win CTF fixture.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
char *gets(char *);
__attribute__((used,noinline)) void win(void) {
    puts(getenv("FLAG") ? getenv("FLAG") : "Flag not configured");
    fflush(stdout);
    _exit(0);
}
// Explicit frame layout: 64-byte buffer + saved RBP = 72 bytes to return address.
__asm__(".global vulnerable\n"
        "vulnerable:\n"
        "push %rbp\nmov %rsp,%rbp\nsub $64,%rsp\n"
        "lea -64(%rbp),%rdi\ncall gets@PLT\nleave\nret\n");
extern void vulnerable(void);
int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    puts("SIGMA OVERFLOW // x86-64\nTell me how sigma you are:");
    vulnerable();
    puts("Skill issue.");
    return 0;
}
