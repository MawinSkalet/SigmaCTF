"""Deterministic, harmless training artifacts; no third-party Python dependencies."""
from pathlib import Path
import struct
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/api/artifacts'
OUT.mkdir(parents=True, exist_ok=True)
message = int.from_bytes(b'sigma{cube_root_rizz}', 'big')
# Public 2048-bit modulus; m^3 < n is the intended weakness.
n = (2**1024 - 109) * (2**1024 - 159)
(OUT / 'baby-rsa.txt').write_text(f'n = {n}\ne = 3\nc = {message**3}\n', encoding='utf-8')
def checksum(data):
    if len(data) % 2: data += b'\0'
    total = sum(struct.unpack('!' + 'H' * (len(data)//2), data))
    while total >> 16: total = (total & 65535) + (total >> 16)
    return (~total) & 65535
capture = bytearray(struct.pack('<IHHIIII',0xa1b2c3d4,2,4,0,0,65535,1))
flag = b'sigma{echoes_in_the_void}'
for seq, start in enumerate(range(0,len(flag),6),1):
    payload = flag[start:start+6]
    icmp = struct.pack('!BBHHH',8,0,0,0x5347,seq) + payload
    icmp = icmp[:2] + struct.pack('!H',checksum(icmp)) + icmp[4:]
    ip = struct.pack('!BBHHHBBH4s4s',0x45,0,20+len(icmp),seq,0,64,1,0,b'\x0a\x00\x00\x02',b'\x0a\x00\x00\x03')
    ip = ip[:10] + struct.pack('!H',checksum(ip)) + ip[12:]
    ethernet = bytes.fromhex('0200000000030200000000020800')
    packet = ethernet + ip + icmp
    capture += struct.pack('<IIII',1700000000+seq,0,len(packet),len(packet)) + packet
(OUT / 'phantom-rizz.pcap').write_bytes(capture)
print('Generated baby-rsa.txt and phantom-rizz.pcap')
