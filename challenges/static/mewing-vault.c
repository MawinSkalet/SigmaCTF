#include <stdio.h>
#include <string.h>
static unsigned char vault[] = {26,0,14,4,8,18,17,6,27,54,0,26,54,7,6,29,54,8,54,5,6,10,2,20};
int main(void) {
    char key[128];
    puts("MEWING VAULT v1.0 // Enter the key:");
    if (!fgets(key, sizeof(key), stdin)) return 1;
    key[strcspn(key,"\r\n")] = 0;
    if (strlen(key) != sizeof(vault)) { puts("Cooked."); return 1; }
    for (unsigned i=0; i<sizeof(vault); i++) if (((unsigned char)key[i]^0x69) != vault[i]) { puts("Cooked."); return 1; }
    puts("Aura restored. The key is your flag.");
    return 0;
}
