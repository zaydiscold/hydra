# Recon Tools Used — OpenRouter Infrastructure Assessment
> **Date:** 2026-03-30

## Tools Used & Status

| # | Tool | Purpose | Status | Install |
|---|------|---------|--------|---------|
| 1 | **subfinder** | Subdomain enumeration via passive sources (DNS, certs, APIs) | ✅ Ran successfully — 16 subdomains found | `brew install subfinder` |
| 2 | **httpx** | HTTP probing — checks live hosts, status codes, tech stack, titles | ✅ Ran successfully — all 16 subdomains probed | `brew install httpx` |
| 13 | **Hydra Discovery** | Automated tRPC discovery via Playwright & persistent DB cache | ✅ Integrated & Persistent | Built-in |
| 3 | **katana** | JavaScript-aware web crawler — follows links, JS files, form actions | ✅ Ran successfully — 5600+ URLs crawled | `brew install katana` |
| 4 | **curl** | Manual endpoint brute-forcing — tested 38 API paths | ✅ Ran successfully | Built-in |
| 5 | **waybackurls** | Fetches historical URLs from Wayback Machine | ⚠️ Hung in Antigravity terminal | `go install github.com/tomnomnom/waybackurls@latest` |
| 6 | **gau** | GetAllURLs — fetches from Wayback, Common Crawl, OTX, URLScan | ⚠️ Hung in Antigravity terminal | `brew install gau` |
| 7 | **nuclei** | Vulnerability scanner — tests against 7000+ CVE/misconfig templates | ⚠️ Hung in Antigravity terminal | `brew install nuclei` |
| 8 | **hakrawler** | Fast web crawler focused on discovering endpoints | ⚠️ Hung in Antigravity terminal | `go install github.com/hakluke/hakrawler@latest` |
| 9 | **amass** | Advanced subdomain enumeration — OWASP project, very thorough | ⚠️ Hung in Antigravity terminal | `brew install amass` |
| 10 | **ffuf** | Fast web fuzzer — directory/parameter brute forcing | ✅ Available, not used (endpoint bruting done via curl) | `brew install ffuf` |
| 11 | **gobuster** | Directory/file brute forcing | ✅ Available, not used | `brew install gobuster` |
| 12 | **feroxbuster** | Recursive content discovery (Rust, very fast) | ✅ Available, not used | `brew install feroxbuster` |

## Tool Categories

### Subdomain Discovery
- **subfinder** — passive subdomain enumeration
- **amass** — deep subdomain enumeration (OWASP)

### URL/Endpoint Discovery
- **katana** — JavaScript-aware crawler
- **waybackurls** — Wayback Machine archive
- **gau** — multi-source URL archive
- **hakrawler** — fast endpoint crawler

### HTTP Probing & Tech Detection
- **httpx** — live host probing with tech stack detection

### Vulnerability Scanning
- **nuclei** — template-based vulnerability scanning

### Directory/Path Brute Forcing
- **ffuf** — fast fuzzer
- **gobuster** — directory bruster
- **feroxbuster** — recursive content discovery

### Manual
- **curl** — HTTP requests + endpoint testing

## Running the Hung Tools Manually

The following tools hung in Antigravity's terminal (platform issue). Run them in a regular terminal:

```bash
# Wayback Machine URLs
echo openrouter.ai | waybackurls | sort -u | tee /tmp/or_wayback.txt

# Get All URLs (multi-source)
gau openrouter.ai | sort -u | tee /tmp/or_gau.txt

# Vulnerability scan
nuclei -u https://openrouter.ai -severity low,medium,high,critical -o /tmp/or_nuclei.txt

# Hakrawler
echo https://openrouter.ai | hakrawler -d 3 -subs | sort -u | tee /tmp/or_hakrawler.txt

# Amass (slow but thorough)
amass enum -passive -d openrouter.ai -o /tmp/or_amass.txt

# FFUF directory brute (if you have a wordlist)
ffuf -u https://openrouter.ai/api/FUZZ -w /path/to/wordlist.txt -mc 200,301,302,403

# Feroxbuster recursive
feroxbuster -u https://openrouter.ai/api/ -w /path/to/wordlist.txt
```

## All Available on System

All 12 tools are installed at:
```
/opt/homebrew/bin/subfinder
/opt/homebrew/bin/httpx
/opt/homebrew/bin/katana
/opt/homebrew/bin/nuclei
/opt/homebrew/bin/ffuf
/opt/homebrew/bin/gobuster
/opt/homebrew/bin/feroxbuster
/opt/homebrew/bin/amass
/opt/homebrew/bin/gau
/Users/zaydk/go/bin/waybackurls
/Users/zaydk/go/bin/hakrawler
/usr/bin/curl
```
