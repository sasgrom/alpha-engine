/**
 * Static GICS snapshot of the S&P 500 constituents (decision D14).
 *
 * WHY STATIC AND NOT LIVE-FETCH: the index membership changes 2–5 times a
 * year, a company's GICS classification even less often. A one-time snapshot
 * with a date + a manual refresh once a quarter is more reliable than
 * fragile Wikipedia parsing at runtime (the sandbox/preview may have no
 * external network). Brand-new companies never enter the platform anyway:
 * they lack the 2–5 years of fundamental history, so snapshot "freshness"
 * is not critical.
 *
 * Source: Wikipedia "List of S&P 500 companies", the id=constituents
 * table (columns Symbol | Security | GICS Sector | GICS Sub-Industry | … |
 * CIK). Captured: 2026-10-11. To update: re-capture the table, replace the
 * RAW block, bump GICS_SNAPSHOT_AS_OF.
 *
 * RAW row format: TICKER|CIK|GICS Sector|GICS Sub-Industry
 * (CIK without leading zeros — a number, as in companies.cik).
 */
export const GICS_SNAPSHOT_AS_OF = "2026-10-11";

const RAW = `MMM|66740|Industrials|Industrial Conglomerates
AOS|91142|Industrials|Building Products
ABT|1800|Health Care|Health Care Equipment
ABBV|1551152|Health Care|Biotechnology
ACN|1467373|Information Technology|IT Consulting & Other Services
ADBE|796343|Information Technology|Application Software
AMD|2488|Information Technology|Semiconductors
AES|874761|Utilities|Independent Power Producers & Energy Traders
AFL|4977|Financials|Life & Health Insurance
A|1090872|Health Care|Life Sciences Tools & Services
APD|2969|Materials|Industrial Gases
ABNB|1559720|Consumer Discretionary|Hotels, Resorts & Cruise Lines
AKAM|1086222|Information Technology|Internet Services & Infrastructure
ALB|915913|Materials|Specialty Chemicals
ARE|1035443|Real Estate|Office REITs
ALGN|1097149|Health Care|Health Care Supplies
ALLE|1579241|Industrials|Building Products
LNT|352541|Utilities|Electric Utilities
ALL|899051|Financials|Property & Casualty Insurance
GOOGL|1652044|Communication Services|Interactive Media & Services
GOOG|1652044|Communication Services|Interactive Media & Services
MO|764180|Consumer Staples|Tobacco
AMZN|1018724|Consumer Discretionary|Broadline Retail
AMCR|1748790|Materials|Paper & Plastic Packaging Products & Materials
AEE|1002910|Utilities|Multi-Utilities
AEP|4904|Utilities|Electric Utilities
AXP|4962|Financials|Consumer Finance
AIG|5272|Financials|Multi-line Insurance
AMT|1053507|Real Estate|Telecom Tower REITs
AWK|1410636|Utilities|Water Utilities
AMP|820027|Financials|Asset Management & Custody Banks
AME|1037868|Industrials|Electrical Components & Equipment
AMGN|318154|Health Care|Biotechnology
APH|820313|Information Technology|Electronic Components
ADI|6281|Information Technology|Semiconductors
AON|315293|Financials|Insurance Brokers
APA|1841666|Energy|Oil & Gas Exploration & Production
APO|1858681|Financials|Asset Management & Custody Banks
AAPL|320193|Information Technology|Technology Hardware, Storage & Peripherals
AMAT|6951|Information Technology|Semiconductor Materials & Equipment
APP|1751008|Communication Services|Advertising
APTV|1521332|Consumer Discretionary|Automotive Parts & Equipment
ACGL|947484|Financials|Property & Casualty Insurance
ADM|7084|Consumer Staples|Agricultural Products & Services
ARES|1176948|Financials|Asset Management & Custody Banks
ANET|1596532|Information Technology|Communications Equipment
AJG|354190|Financials|Insurance Brokers
AIZ|1267238|Financials|Multi-line Insurance
T|732717|Communication Services|Integrated Telecommunication Services
ATO|731802|Utilities|Gas Utilities
ADSK|769397|Information Technology|Application Software
ADP|8670|Industrials|Human Resource & Employment Services
AZO|866787|Consumer Discretionary|Automotive Retail
AVY|8818|Materials|Paper & Plastic Packaging Products & Materials
AXON|1069183|Industrials|Aerospace & Defense
BKR|1701605|Energy|Oil & Gas Equipment & Services
BALL|9389|Materials|Metal, Glass & Plastic Containers
BAC|70858|Financials|Diversified Banks
BAX|10456|Health Care|Health Care Equipment
BDX|10795|Health Care|Health Care Equipment
BRK.B|1067983|Financials|Multi-Sector Holdings
BBY|764478|Consumer Discretionary|Computer & Electronics Retail
TECH|842023|Health Care|Life Sciences Tools & Services
BIIB|875045|Health Care|Biotechnology
BLK|2012383|Financials|Asset Management & Custody Banks
BX|1393818|Financials|Asset Management & Custody Banks
XYZ|1512673|Financials|Transaction & Payment Processing Services
BE|1664703|Industrials|Electrical Components & Equipment
BNY|1390777|Financials|Asset Management & Custody Banks
BA|12927|Industrials|Aerospace & Defense
BKNG|1075531|Consumer Discretionary|Hotels, Resorts & Cruise Lines
BSX|885725|Health Care|Health Care Equipment
BMY|14272|Health Care|Pharmaceuticals
AVGO|1730168|Information Technology|Semiconductors
BR|1383312|Industrials|Data Processing & Outsourced Services
BRO|79282|Financials|Insurance Brokers
BF.B|14693|Consumer Staples|Distillers & Vintners
BG|1996862|Consumer Staples|Agricultural Products & Services
BXP|1037540|Real Estate|Office REITs
CHRW|1043277|Industrials|Air Freight & Logistics
CDNS|813672|Information Technology|Application Software
CPT|906345|Real Estate|Multi-Family Residential REITs
COF|927628|Financials|Consumer Finance
CAH|721371|Health Care|Health Care Distributors
CCL|815097|Consumer Discretionary|Hotels, Resorts & Cruise Lines
CARR|1783180|Industrials|Building Products
CVNA|1690820|Consumer Discretionary|Automotive Retail
CASY|726958|Consumer Staples|Food Retail
CAT|18230|Industrials|Construction Machinery & Heavy Transportation Equipment
CBOE|1374310|Financials|Financial Exchanges & Data
CBRE|1138118|Real Estate|Real Estate Services
CDW|1402057|Information Technology|Technology Distributors
COR|1140859|Health Care|Health Care Distributors
CNC|1071739|Health Care|Managed Health Care
CNP|1130310|Utilities|Multi-Utilities
CF|1324404|Materials|Fertilizers & Agricultural Chemicals
CRL|1100682|Health Care|Life Sciences Tools & Services
SCHW|316709|Financials|Investment Banking & Brokerage
CHTR|1091667|Communication Services|Cable & Satellite
CVX|93410|Energy|Integrated Oil & Gas
CMG|1058090|Consumer Discretionary|Restaurants
CB|896159|Financials|Property & Casualty Insurance
CHD|313927|Consumer Staples|Household Products
CIEN|936395|Information Technology|Communications Equipment
CI|1739940|Health Care|Health Care Services
CINF|20286|Financials|Property & Casualty Insurance
CTAS|723254|Industrials|Diversified Support Services
CSCO|858877|Information Technology|Communications Equipment
C|831001|Financials|Diversified Banks
CFG|759944|Financials|Regional Banks
CLX|21076|Consumer Staples|Household Products
CME|1156375|Financials|Financial Exchanges & Data
CMS|811156|Utilities|Multi-Utilities
KO|21344|Consumer Staples|Soft Drinks & Non-alcoholic Beverages
CTSH|1058290|Information Technology|IT Consulting & Other Services
COHR|820318|Information Technology|Electronic Components
COIN|1679788|Financials|Financial Exchanges & Data
CL|21665|Consumer Staples|Household Products
CMCSA|1166691|Communication Services|Cable & Satellite
FIX|1035983|Industrials|Construction & Engineering
COP|1163165|Energy|Oil & Gas Exploration & Production
ED|1047862|Utilities|Multi-Utilities
STZ|16918|Consumer Staples|Distillers & Vintners
CEG|1868275|Utilities|Electric Utilities
COO|711404|Health Care|Health Care Supplies
CPRT|900075|Industrials|Diversified Support Services
GLW|24741|Information Technology|Electronic Components
CPAY|1175454|Financials|Transaction & Payment Processing Services
CSGP|1057352|Real Estate|Real Estate Services
COST|909832|Consumer Staples|Consumer Staples Merchandise Retail
CRH|849395|Materials|Construction Materials
CRWD|1535527|Information Technology|Systems Software
CCI|1051470|Real Estate|Telecom Tower REITs
CSX|277948|Industrials|Rail Transportation
CMI|26172|Industrials|Construction Machinery & Heavy Transportation Equipment
CVS|64803|Health Care|Health Care Services
DHR|313616|Health Care|Life Sciences Tools & Services
DRI|940944|Consumer Discretionary|Restaurants
DDOG|1561550|Information Technology|Application Software
DVA|927066|Health Care|Health Care Services
DECK|910521|Consumer Discretionary|Footwear
DE|315189|Industrials|Agricultural & Farm Machinery
DELL|1571996|Information Technology|Technology Hardware, Storage & Peripherals
DAL|27904|Industrials|Passenger Airlines
DVN|1090012|Energy|Oil & Gas Exploration & Production
DXCM|1093557|Health Care|Health Care Equipment
FANG|1539838|Energy|Oil & Gas Exploration & Production
DLR|1297996|Real Estate|Data Center REITs
DG|29534|Consumer Staples|Consumer Staples Merchandise Retail
DLTR|935703|Consumer Staples|Consumer Staples Merchandise Retail
D|715957|Utilities|Multi-Utilities
DPZ|1286681|Consumer Discretionary|Restaurants
DASH|1792789|Consumer Discretionary|Specialized Consumer Services
DOV|29905|Industrials|Industrial Machinery & Supplies & Components
DOW|1751788|Materials|Commodity Chemicals
DHI|882184|Consumer Discretionary|Homebuilding
DTE|936340|Utilities|Multi-Utilities
DUK|1326160|Utilities|Electric Utilities
DD|1666700|Industrials|Industrial Conglomerates
ETN|1551182|Industrials|Electrical Components & Equipment
EBAY|1065088|Consumer Discretionary|Broadline Retail
ECHO|1415404|Communication Services|Wireless Telecommunication Services
ECL|31462|Materials|Specialty Chemicals
EIX|827052|Utilities|Electric Utilities
EW|1099800|Health Care|Health Care Equipment
ELV|1156039|Health Care|Managed Health Care
EME|105634|Industrials|Construction & Engineering
EMR|32604|Industrials|Electrical Components & Equipment
ETR|65984|Utilities|Electric Utilities
EOG|821189|Energy|Oil & Gas Exploration & Production
EQT|33213|Energy|Oil & Gas Exploration & Production
EFX|33185|Industrials|Research & Consulting Services
EQIX|1101239|Real Estate|Data Center REITs
ERIE|922621|Financials|Insurance Brokers
ESS|920522|Real Estate|Multi-Family Residential REITs
EL|1001250|Consumer Staples|Personal Care Products
EG|1095073|Financials|Reinsurance
EVRG|1711269|Utilities|Electric Utilities
ES|72741|Utilities|Electric Utilities
EXC|1109357|Utilities|Electric Utilities
EXE|895126|Energy|Oil & Gas Exploration & Production
EXPE|1324424|Consumer Discretionary|Hotels, Resorts & Cruise Lines
EXPD|746515|Industrials|Air Freight & Logistics
EXR|1289490|Real Estate|Self-Storage REITs
XOM|2115436|Energy|Integrated Oil & Gas
FFIV|1048695|Information Technology|Communications Equipment
FDS|1013237|Financials|Financial Exchanges & Data
FICO|814547|Information Technology|Application Software
FAST|815556|Industrials|Trading Companies & Distributors
FRT|34903|Real Estate|Retail REITs
FDX|1048911|Industrials|Air Freight & Logistics
FDXF|2082247|Industrials|Cargo Ground Transportation
FERG|2011641|Industrials|Trading Companies & Distributors
FIS|1136893|Financials|Transaction & Payment Processing Services
FITB|35527|Financials|Regional Banks
FSLR|1274494|Information Technology|Semiconductors
FE|1031296|Utilities|Electric Utilities
FISV|798354|Financials|Transaction & Payment Processing Services
FLEX|866374|Information Technology|Electronic Manufacturing Services
F|37996|Consumer Discretionary|Automobile Manufacturers
FTNT|1262039|Information Technology|Systems Software
FTV|1659166|Industrials|Industrial Machinery & Supplies & Components
FOXA|1754301|Communication Services|Broadcasting
FOX|1754301|Communication Services|Broadcasting
BEN|38777|Financials|Asset Management & Custody Banks
FCX|831259|Materials|Copper
GRMN|1121788|Consumer Discretionary|Consumer Electronics
IT|749251|Information Technology|IT Consulting & Other Services
GE|40545|Industrials|Aerospace & Defense
GEHC|1932393|Health Care|Health Care Equipment
GEV|1996810|Industrials|Heavy Electrical Equipment
GEN|849399|Information Technology|Systems Software
GNRC|1474735|Industrials|Heavy Electrical Equipment
GD|40533|Industrials|Aerospace & Defense
GIS|40704|Consumer Staples|Packaged Foods & Meats
GM|1467858|Consumer Discretionary|Automobile Manufacturers
GPC|40987|Consumer Discretionary|Distributors
GILD|882095|Health Care|Biotechnology
GPN|1123360|Financials|Transaction & Payment Processing Services
GL|320335|Financials|Life & Health Insurance
GDDY|1609711|Information Technology|Internet Services & Infrastructure
GS|886982|Financials|Investment Banking & Brokerage
HAL|45012|Energy|Oil & Gas Equipment & Services
HIG|874766|Financials|Property & Casualty Insurance
HAS|49280|Consumer Discretionary|Leisure Products
HCA|860730|Health Care|Health Care Facilities
DOC|765880|Real Estate|Health Care REITs
HSIC|1000228|Health Care|Health Care Distributors
HSY|47111|Consumer Staples|Packaged Foods & Meats
HPE|1645590|Information Technology|Technology Hardware, Storage & Peripherals
HLT|1585689|Consumer Discretionary|Hotels, Resorts & Cruise Lines
HD|354950|Consumer Discretionary|Home Improvement Retail
HONA|2089271|Industrials|Aerospace & Defense
HON|773840|Industrials|Industrial Conglomerates
HRL|48465|Consumer Staples|Packaged Foods & Meats
HST|1070750|Real Estate|Hotel & Resort REITs
HWM|4281|Industrials|Aerospace & Defense
HPQ|47217|Information Technology|Technology Hardware, Storage & Peripherals
HUBB|48898|Industrials|Industrial Machinery & Supplies & Components
HUM|49071|Health Care|Managed Health Care
HBAN|49196|Financials|Regional Banks
HII|1501585|Industrials|Aerospace & Defense
IBM|51143|Information Technology|IT Consulting & Other Services
IEX|832101|Industrials|Industrial Machinery & Supplies & Components
IDXX|874716|Health Care|Health Care Equipment
ITW|49826|Industrials|Industrial Machinery & Supplies & Components
ILMN|1110803|Health Care|Life Sciences Tools & Services
INCY|879169|Health Care|Biotechnology
IR|1699150|Industrials|Industrial Machinery & Supplies & Components
PODD|1145197|Health Care|Health Care Equipment
INTC|50863|Information Technology|Semiconductors
IBKR|1381197|Financials|Investment Banking & Brokerage
ICE|1571949|Financials|Financial Exchanges & Data
IFF|51253|Materials|Specialty Chemicals
IP|51434|Materials|Paper & Plastic Packaging Products & Materials
INTU|896878|Information Technology|Application Software
ISRG|1035267|Health Care|Health Care Equipment
IVZ|914208|Financials|Asset Management & Custody Banks
INVH|1687229|Real Estate|Single-Family Residential REITs
IQV|1478242|Health Care|Life Sciences Tools & Services
IRM|1020569|Real Estate|Other Specialized REITs
JBHT|728535|Industrials|Cargo Ground Transportation
JBL|898293|Information Technology|Electronic Manufacturing Services
JKHY|779152|Financials|Investment Banking & Brokerage
J|52988|Industrials|Construction & Engineering
JNJ|200406|Health Care|Pharmaceuticals
JCI|833444|Industrials|Building Products
JPM|19617|Financials|Diversified Banks
KVUE|1944048|Consumer Staples|Personal Care Products
KDP|1418135|Consumer Staples|Soft Drinks & Non-alcoholic Beverages
KEY|91576|Financials|Regional Banks
KEYS|1601046|Information Technology|Electronic Equipment & Instruments
KMB|55785|Consumer Staples|Household Products
KIM|879101|Real Estate|Retail REITs
KMI|1506307|Energy|Oil & Gas Storage & Transportation
KKR|1404912|Financials|Asset Management & Custody Banks
KLAC|319201|Information Technology|Semiconductor Materials & Equipment
KHC|1637459|Consumer Staples|Packaged Foods & Meats
KR|56873|Consumer Staples|Food Retail
LHX|202058|Industrials|Aerospace & Defense
LH|920148|Health Care|Health Care Services
LRCX|707549|Information Technology|Semiconductor Materials & Equipment
LVS|1300514|Consumer Discretionary|Casinos & Gaming
LDOS|1336920|Industrials|Diversified Support Services
LEN|920760|Consumer Discretionary|Homebuilding
LII|1069202|Industrials|Building Products
LLY|59478|Health Care|Pharmaceuticals
LIN|1707925|Materials|Industrial Gases
LYV|1335258|Communication Services|Movies & Entertainment
LMT|936468|Industrials|Aerospace & Defense
L|60086|Financials|Multi-line Insurance
LOW|60667|Consumer Discretionary|Home Improvement Retail
LULU|1397187|Consumer Discretionary|Apparel, Accessories & Luxury Goods
LITE|1633978|Information Technology|Communications Equipment
LYB|1489393|Materials|Specialty Chemicals
MTB|36270|Financials|Regional Banks
MPC|1510295|Energy|Oil & Gas Refining & Marketing
MAR|1048286|Consumer Discretionary|Hotels, Resorts & Cruise Lines
MRSH|62709|Financials|Insurance Brokers
MLM|916076|Materials|Construction Materials
MRVL|1835632|Information Technology|Semiconductors
MAS|62996|Industrials|Building Products
MA|1141391|Financials|Transaction & Payment Processing Services
MKC|63754|Consumer Staples|Packaged Foods & Meats
MCD|63908|Consumer Discretionary|Restaurants
MCK|927653|Health Care|Health Care Distributors
MDT|1613103|Health Care|Health Care Equipment
MRK|310158|Health Care|Pharmaceuticals
META|1326801|Communication Services|Interactive Media & Services
MET|1099219|Financials|Life & Health Insurance
MTD|1037646|Health Care|Life Sciences Tools & Services
MGM|789570|Consumer Discretionary|Casinos & Gaming
MCHP|827054|Information Technology|Semiconductors
MU|723125|Information Technology|Semiconductors
MSFT|789019|Information Technology|Systems Software
MAA|912595|Real Estate|Multi-Family Residential REITs
MRNA|1682852|Health Care|Biotechnology
MDLZ|1103982|Consumer Staples|Packaged Foods & Meats
MPWR|1280452|Information Technology|Semiconductors
MNST|865752|Consumer Staples|Soft Drinks & Non-alcoholic Beverages
MCO|1059556|Financials|Financial Exchanges & Data
MS|895421|Financials|Investment Banking & Brokerage
MOS|1285785|Materials|Fertilizers & Agricultural Chemicals
MSI|68505|Information Technology|Communications Equipment
MSCI|1408198|Financials|Financial Exchanges & Data
NDAQ|1120193|Financials|Financial Exchanges & Data
NTAP|1002047|Information Technology|Technology Hardware, Storage & Peripherals
NFLX|1065280|Communication Services|Movies & Entertainment
NEM|1164727|Materials|Gold
NWSA|1564708|Communication Services|Publishing
NWS|1564708|Communication Services|Publishing
NEE|753308|Utilities|Multi-Utilities
NKE|320187|Consumer Discretionary|Apparel, Accessories & Luxury Goods
NI|1111711|Utilities|Multi-Utilities
NDSN|72331|Industrials|Industrial Machinery & Supplies & Components
NSC|702165|Industrials|Rail Transportation
NTRS|73124|Financials|Asset Management & Custody Banks
NOC|1133421|Industrials|Aerospace & Defense
NCLH|1513761|Consumer Discretionary|Hotels, Resorts & Cruise Lines
NRG|1013871|Utilities|Independent Power Producers & Energy Traders
NUE|73309|Materials|Steel
NVDA|1045810|Information Technology|Semiconductors
NVR|906163|Consumer Discretionary|Homebuilding
NXPI|1413447|Information Technology|Semiconductors
ORLY|898173|Consumer Discretionary|Automotive Retail
OXY|797468|Energy|Oil & Gas Exploration & Production
ODFL|878927|Industrials|Cargo Ground Transportation
OMC|29989|Communication Services|Advertising
ON|1097864|Information Technology|Semiconductors
OKE|1039684|Energy|Oil & Gas Storage & Transportation
ORCL|1341439|Information Technology|Application Software
OTIS|1781335|Industrials|Industrial Machinery & Supplies & Components
PCAR|75362|Industrials|Construction Machinery & Heavy Transportation Equipment
PKG|75677|Materials|Paper & Plastic Packaging Products & Materials
PLTR|1321655|Information Technology|Application Software
PANW|1327567|Information Technology|Systems Software
PH|773634|Industrials|Industrial Machinery & Supplies & Components
PAYX|723531|Industrials|Human Resource & Employment Services
PYPL|1633917|Financials|Transaction & Payment Processing Services
PNR|77360|Industrials|Industrial Machinery & Supplies & Components
PEP|77476|Consumer Staples|Soft Drinks & Non-alcoholic Beverages
PFE|78003|Health Care|Pharmaceuticals
PCG|1004980|Utilities|Multi-Utilities
PM|1413329|Consumer Staples|Tobacco
PSX|1534701|Energy|Oil & Gas Refining & Marketing
PNW|764622|Utilities|Multi-Utilities
PNC|713676|Financials|Diversified Banks
PPG|79879|Materials|Specialty Chemicals
PPL|922224|Utilities|Electric Utilities
PFG|1126328|Financials|Life & Health Insurance
PG|80424|Consumer Staples|Personal Care Products
PGR|80661|Financials|Property & Casualty Insurance
PLD|1045609|Real Estate|Industrial REITs
PRU|1137774|Financials|Life & Health Insurance
PEG|788784|Utilities|Electric Utilities
PTC|857005|Information Technology|Application Software
PSA|1393311|Real Estate|Self-Storage REITs
PHM|822416|Consumer Discretionary|Homebuilding
PWR|1050915|Industrials|Construction & Engineering
QCOM|804328|Information Technology|Semiconductors
DGX|1022079|Health Care|Health Care Services
Q|2058873|Information Technology|Semiconductor Materials & Equipment
RL|1037038|Consumer Discretionary|Apparel, Accessories & Luxury Goods
RJF|720005|Financials|Investment Banking & Brokerage
RDDT|1713445|Communication Services|Interactive Media & Services
RTX|101829|Industrials|Aerospace & Defense
O|726728|Real Estate|Retail REITs
REG|910606|Real Estate|Retail REITs
REGN|872589|Health Care|Biotechnology
RF|1281761|Financials|Regional Banks
RSG|1060391|Industrials|Environmental & Facilities Services
RMD|943819|Health Care|Health Care Equipment
RVTY|31791|Health Care|Health Care Equipment
HOOD|1783879|Financials|Investment Banking & Brokerage
ROK|1024478|Industrials|Electrical Components & Equipment
ROL|84839|Industrials|Environmental & Facilities Services
ROP|882835|Information Technology|Electronic Equipment & Instruments
ROST|745732|Consumer Discretionary|Apparel Retail
RCL|884887|Consumer Discretionary|Hotels, Resorts & Cruise Lines
SPGI|64040|Financials|Financial Exchanges & Data
CRM|1108524|Information Technology|Application Software
SNDK|2023554|Information Technology|Technology Hardware, Storage & Peripherals
SBAC|1034054|Real Estate|Telecom Tower REITs
SLB|87347|Energy|Oil & Gas Equipment & Services
STX|1137789|Information Technology|Technology Hardware, Storage & Peripherals
SRE|1032208|Utilities|Multi-Utilities
NOW|1373715|Information Technology|Systems Software
SHW|89800|Materials|Specialty Chemicals
SPG|1063761|Real Estate|Retail REITs
SKYD|2041610|Communication Services|Movies & Entertainment
SWKS|4127|Information Technology|Semiconductors
SJM|91419|Consumer Staples|Packaged Foods & Meats
SW|2005951|Materials|Paper & Plastic Packaging Products & Materials
SNA|91440|Industrials|Industrial Machinery & Supplies & Components
SOLV|1964738|Health Care|Health Care Technology
SO|92122|Utilities|Electric Utilities
LUV|92380|Industrials|Passenger Airlines
SWK|93556|Industrials|Industrial Machinery & Supplies & Components
SBUX|829224|Consumer Discretionary|Restaurants
STT|93751|Financials|Asset Management & Custody Banks
STLD|1022671|Materials|Steel
STE|1757898|Health Care|Health Care Equipment
SYK|310764|Health Care|Health Care Equipment
SMCI|1375365|Information Technology|Technology Hardware, Storage & Peripherals
SYF|1601712|Financials|Consumer Finance
SNPS|883241|Information Technology|Application Software
SYY|96021|Consumer Staples|Food Distributors
TMUS|1283699|Communication Services|Wireless Telecommunication Services
TROW|1006367|Financials|Asset Management & Custody Banks
TTWO|946581|Communication Services|Interactive Home Entertainment
TPR|1077205|Consumer Discretionary|Apparel, Accessories & Luxury Goods
TRGP|1389170|Energy|Oil & Gas Storage & Transportation
TGT|27474|Consumer Staples|Consumer Staples Merchandise Retail
TEL|1385157|Information Technology|Electronic Manufacturing Services
TDY|1094285|Information Technology|Electronic Equipment & Instruments
TER|97210|Information Technology|Semiconductor Materials & Equipment
TSLA|1318605|Consumer Discretionary|Automobile Manufacturers
TXN|97476|Information Technology|Semiconductors
TPL|1811074|Energy|Oil & Gas Exploration & Production
TXT|217346|Industrials|Aerospace & Defense
TMO|97745|Health Care|Life Sciences Tools & Services
TJX|109198|Consumer Discretionary|Apparel Retail
TKO|1973266|Communication Services|Movies & Entertainment
TSCO|916365|Consumer Discretionary|Other Specialty Retail
TT|1466258|Industrials|Building Products
TDG|1260221|Industrials|Aerospace & Defense
TRV|86312|Financials|Property & Casualty Insurance
TRMB|864749|Information Technology|Application Software
TFC|92230|Financials|Diversified Banks
TWLO|1447669|Information Technology|Systems Software
TYL|860731|Information Technology|Application Software
TSN|100493|Consumer Staples|Packaged Foods & Meats
USB|36104|Financials|Diversified Banks
UBER|1543151|Industrials|Passenger Ground Transportation
UDR|74208|Real Estate|Multi-Family Residential REITs
ULTA|1403568|Consumer Discretionary|Other Specialty Retail
UNP|100885|Industrials|Rail Transportation
UAL|100517|Industrials|Passenger Airlines
UPS|1090727|Industrials|Air Freight & Logistics
URI|1067701|Industrials|Trading Companies & Distributors
UNH|731766|Health Care|Managed Health Care
UHS|352915|Health Care|Health Care Facilities
VLO|1035002|Energy|Oil & Gas Refining & Marketing
VEEV|1393052|Health Care|Health Care Technology
VTR|740260|Real Estate|Health Care REITs
VLTO|1967680|Industrials|Environmental & Facilities Services
VRSN|1014473|Information Technology|Internet Services & Infrastructure
VRSK|1442145|Industrials|Research & Consulting Services
VZ|732712|Communication Services|Integrated Telecommunication Services
VRTX|875320|Health Care|Biotechnology
VRT|1674101|Industrials|Electrical Components & Equipment
VTRS|1792044|Health Care|Pharmaceuticals
VICI|1705696|Real Estate|Hotel & Resort REITs
V|1403161|Financials|Transaction & Payment Processing Services
VST|1692819|Utilities|Electric Utilities
VMRK|906107|Real Estate|Multi-Family Residential REITs
VMC|1396009|Materials|Construction Materials
VYLR|2128626|Consumer Staples|Agricultural Products & Services
WRB|11544|Financials|Property & Casualty Insurance
GWW|277135|Industrials|Industrial Machinery & Supplies & Components
WAB|943452|Industrials|Construction Machinery & Heavy Transportation Equipment
WMT|104169|Consumer Staples|Consumer Staples Merchandise Retail
DIS|1744489|Communication Services|Movies & Entertainment
WM|823768|Industrials|Environmental & Facilities Services
WAT|1000697|Health Care|Life Sciences Tools & Services
WEC|783325|Utilities|Electric Utilities
WFC|72971|Financials|Diversified Banks
WELL|704808|Real Estate|Health Care REITs
WST|105770|Health Care|Health Care Supplies
WDC|106040|Information Technology|Technology Hardware, Storage & Peripherals
WY|106535|Real Estate|Timber REITs
WSM|719955|Consumer Discretionary|Homefurnishing Retail
WMB|107263|Energy|Oil & Gas Storage & Transportation
WTW|1140536|Financials|Insurance Brokers
WDAY|1327811|Information Technology|Application Software
WYNN|1174922|Consumer Discretionary|Casinos & Gaming
XEL|72903|Utilities|Multi-Utilities
XYL|1524472|Industrials|Industrial Machinery & Supplies & Components
YUM|1041061|Consumer Discretionary|Restaurants
ZBRA|877212|Information Technology|Electronic Equipment & Instruments
ZBH|1136869|Health Care|Health Care Equipment
ZTS|1555280|Health Care|Pharmaceuticals`;

/** One snapshot entry: ticker, CIK (number), GICS sector and sub-industry. */
export interface GicsEntry {
  ticker: string;
  cik: number;
  sector: string;
  industry: string;
}

/**
 * The parsed snapshot; parsed once at module load.
 * Tickers are normalized to SEC style (uppercase, dots -> dashes: BRK.B ->
 * BRK-B) so GICS_BY_TICKER keys match companies.ticker.
 */
export const GICS_SP500: GicsEntry[] = RAW.split("\n").map((line) => {
  const [ticker, cik, sector, industry] = line.split("|");
  return {
    ticker: ticker.trim().toUpperCase().replace(/\./g, "-"),
    cik: Number(cik),
    sector,
    industry,
  };
});

/** Fast lookup indexes for enrichment: by ticker and by CIK (CIK is more reliable — tickers change). */
export const GICS_BY_TICKER = new Map(GICS_SP500.map((e) => [e.ticker, e]));
export const GICS_BY_CIK = new Map(GICS_SP500.map((e) => [e.cik, e]));
