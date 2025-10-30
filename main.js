document.addEventListener("DOMContentLoaded", function() {
    // --- 1. SETUP ---
    let timer;
    let isPlaying = false;
    let selectedMetric = 'New Cases';
    let allData, nestedData, dateRange, filteredDateRange, geoData;
    let dataByProvinceByDate = new Map();

    // Formatters
    const parseDate = d3.timeParse("%m/%d/%Y");
    const formatDate = d3.timeFormat("%b %d, %Y");
    const formatNumber = d3.format(",.0f");

    // Dimensions
    const mapWidth = 960;
    const mapHeight = 500;
    const contextMargin = { top: 10, right: 30, bottom: 30, left: 30 };
    const contextWidth = 960 - contextMargin.left - contextMargin.right;
    const contextHeight = 100 - contextMargin.top - contextMargin.bottom;

    // Map SVG
    const svg = d3.select("#map-chart")
        .attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`); // Membuat responsif
    const mapGroup = svg.append("g"); // Grup untuk Panning/Zooming

    // Context (Timeline) SVG
    const contextSvg = d3.select("#context-chart")
        .attr("width", contextWidth + contextMargin.left + contextMargin.right)
        .attr("height", contextHeight + contextMargin.top + contextMargin.bottom)
        .append("g")
        .attr("transform", `translate(${contextMargin.left},${contextMargin.top})`);

    // Tooltip
    const tooltip = d3.select("#tooltip");

    // Scales
    const colorScale = d3.scaleSequential(d3.interpolateReds).domain([0, 1000]); // Domain akan diperbarui
    const contextXScale = d3.scaleTime().range([0, contextWidth]);
    const contextYScale = d3.scaleLinear().range([contextHeight, 0]);

    // UI Elements
    const dateSlider = d3.select("#date-slider");
    const dateDisplay = d3.select("#date-display");
    const playPauseButton = d3.select("#play-pause-button");
    const metricSelect = d3.select("#metric-select");

    // Proyeksi Peta
    const projection = d3.geoMercator()
        .center([118, -2]) // Pusat Indonesia
        .scale(1000) // Skala zoom awal
        .translate([mapWidth / 2, mapHeight / 2]);
    const path = d3.geoPath().projection(projection);

    // --- 2. DATA LOADING & PROCESSING ---
    Promise.all([
        d3.csv("covid_indonesia_province_cleaned.csv", d => {
            // Parsing data CSV
            d.Date = parseDate(d.Date);
            d['New Cases'] = +d['New Cases'];
            d['New Deaths'] = +d['New Deaths'];
            d['Total Cases'] = +d['Total Cases'];
            d['Total Deaths'] = +d['Total Deaths'];
            d.Province = d.Province.trim();
            return d;
        }),
        d3.json("indonesia-provinces.json") // **PASTIKAN NAMA FILE INI SESUAI**
    ]).then(([covidData, indonesiaGeo]) => {
        allData = covidData;
        geoData = topojson.feature(indonesiaGeo, indonesiaGeo.objects.provinces); // Sesuaikan 'provinces'
        
        // Memproses data COVID untuk pencarian cepat
        nestedData = d3.group(allData, d => d.Date);
        dateRange = Array.from(nestedData.keys()).sort(d3.ascending);
        filteredDateRange = dateRange;
        
        // Membuat lookup map: Map[Date -> Map[Province -> Data]]
        dataByProvinceByDate = new Map();
        for (let [date, values] of nestedData.entries()) {
            const provinceMap = new Map();
            for (let row of values) {
                provinceMap.set(row.Province, row);
            }
            dataByProvinceByDate.set(date, provinceMap);
        }
        
        // Set up slider
        dateSlider.attr("max", dateRange.length - 1);
        
        setupContextChart(); // Setup timeline
        drawMap(); // Gambar peta
        update(0); // Render visualisasi awal

        // --- 3. EVENT LISTENERS ---
        playPauseButton.on("click", togglePlay);
        dateSlider.on("input", () => update(+dateSlider.property("value")));
        metricSelect.on("change", () => {
            selectedMetric = metricSelect.property("value");
            updateContextChart(); // Update domain timeline
            updateColorScale(); // Update domain skala warna
            update(+dateSlider.property("value"));
        });

    }).catch(error => {
        console.error("Error loading data:", error);
    });

    // --- 4. MAP DRAWING & ZOOM ---
    function drawMap() {
        mapGroup.selectAll("path.province")
            .data(geoData.features)
            .enter()
            .append("path")
            .attr("class", "province")
            .attr("d", path)
            .attr("fill", "#ccc") // Warna default
            .on("mouseover", (event, d) => {
                tooltip.style("opacity", 1);
            })
            .on("mousemove", (event, d) => {
                // Ambil nama provinsi dari GeoJSON
                // **PENTING: 'd.properties.NAME_1' mungkin berbeda, sesuaikan!**
                const provinceName = d.properties.NAME_1; 
                
                const currentDate = filteredDateRange[+dateSlider.property("value")];
                const provinceData = dataByProvinceByDate.get(currentDate)?.get(provinceName);
                
                let value = "N/A";
                if (provinceData) {
                    value = formatNumber(provinceData[selectedMetric]);
                }

                tooltip.html(`<strong>${provinceName}</strong><br>${selectedMetric}: ${value}`)
                       .style("left", (event.pageX + 15) + "px")
                       .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.style("opacity", 0);
            });
            
        // Setup Panning & Zooming
        const zoom = d3.zoom()
            .scaleExtent([1, 8]) // Batas zoom
            .on("zoom", (event) => {
                mapGroup.attr("transform", event.transform);
            });
        svg.call(zoom);
    }
    
    // --- 5. CONTEXT CHART (TIMELINE & BRUSH) ---
    // (Fungsi ini hampir sama dengan Plan A)
    function setupContextChart() {
        const nationalTotals = Array.from(nestedData, ([date, values]) => {
            return { date: date, value: d3.sum(values, v => v[selectedMetric]) };
        });
        
        contextXScale.domain(d3.extent(dateRange));
        contextYScale.domain([0, d3.max(nationalTotals, d => d.value)]);

        const contextArea = d3.area()
            .x(d => contextXScale(d.date))
            .y0(contextHeight)
            .y1(d => contextYScale(d.value));
        
        contextSvg.append("path").datum(nationalTotals).attr("class", "context-area").attr("d", contextArea);
        contextSvg.append("g").attr("class", "context-axis").attr("transform", `translate(0,${contextHeight})`).call(d3.axisBottom(contextXScale).ticks(d3.timeYear.every(1)));

        // Anotasi (Sama)
        const annotations = [{ date: "2021-07-15", label: "Puncak Delta" }, { date: "2022-02-15", label: "Puncak Omicron" }];
        annotations.forEach(ann => {
            const xPos = contextXScale(parseDate(ann.date.replace(/-/g, '/')));
            const g = contextSvg.append("g");
            g.append("line").attr("class", "annotation-line").attr("x1", xPos).attr("x2", xPos).attr("y1", 0).attr("y2", contextHeight);
            g.append("text").attr("class", "annotation-text").attr("x", xPos).attr("y", 10).text(ann.label);
        });

        // Brush (Sama)
        const brush = d3.brushX().extent([[0, 0], [contextWidth, contextHeight]]).on("end", brushed);
        contextSvg.append("g").attr("class", "brush").call(brush);

        function brushed({ selection }) {
            if (selection) {
                const [x0, x1] = selection.map(contextXScale.invert);
                filteredDateRange = dateRange.filter(d => d >= x0 && d <= x1);
            } else {
                filteredDateRange = dateRange;
            }
            dateSlider.attr("max", filteredDateRange.length - 1);
            dateSlider.property("value", 0);
            updateColorScale(); // Perbarui skala warna berdasarkan rentang waktu baru
            update(0);
        }
    }
    
    function updateContextChart() {
        // (Sama seperti Plan A, untuk memperbarui timeline saat metrik berubah)
        const nationalTotals = Array.from(nestedData, ([date, values]) => {
            return { date: date, value: d3.sum(values, v => v[selectedMetric]) };
        });
        contextYScale.domain([0, d3.max(nationalTotals, d => d.value)]);
        const contextArea = d3.area().x(d => contextXScale(d.date)).y0(contextHeight).y1(d => contextYScale(d.value));
        contextSvg.select(".context-area").datum(nationalTotals).transition().duration(500).attr("d", contextArea);
    }
    
    function updateColorScale() {
        // Perbarui domain skala warna berdasarkan data yang difilter
        let maxVal = 0;
        for (const date of filteredDateRange) {
            const dailyMax = d3.max(nestedData.get(date) || [], d => d[selectedMetric]);
            if (dailyMax > maxVal) maxVal = dailyMax;
        }
        colorScale.domain([0, maxVal > 0 ? maxVal : 1]);
    }

    // --- 6. UPDATE FUNCTION (Main Logic) ---
    function update(dateIndex) {
        if (!filteredDateRange || filteredDateRange.length === 0) return;
        
        const currentDate = filteredDateRange[dateIndex];
        dateDisplay.text(formatDate(currentDate));
        dateSlider.property("value", dateIndex);

        const currentDataByProvince = dataByProvinceByDate.get(currentDate);
        
        if (!currentDataByProvince) return; // Tidak ada data untuk hari ini

        // Update Peta
        mapGroup.selectAll("path.province")
            .transition()
            .duration(isPlaying ? 150 : 0) // Transisi cepat jika diputar
            .attr("fill", d => {
                // **PENTING: 'd.properties.NAME_1' mungkin berbeda, sesuaikan!**
                const provinceName = d.properties.NAME_1; 
                const provinceData = currentDataByProvince.get(provinceName);
                
                if (provinceData && provinceData[selectedMetric] > 0) {
                    return colorScale(provinceData[selectedMetric]);
                } else {
                    return "#ccc"; // Warna default jika tidak ada data
                }
            });
    }

    // --- 7. ANIMATION CONTROLS ---
    // (Sama seperti Plan A)
    function togglePlay() {
        if (isPlaying) {
            clearInterval(timer);
            playPauseButton.text("Play");
        } else {
            playPauseButton.text("Pause");
            timer = setInterval(() => {
                let currentValue = +dateSlider.property("value");
                let maxValue = +dateSlider.attr("max");
                if (currentValue < maxValue) {
                    currentValue++;
                    update(currentValue);
                } else {
                    clearInterval(timer);
                    isPlaying = false;
                    playPauseButton.text("Play");
                }
            }, 150); // Kecepatan animasi
        }
        isPlaying = !isPlaying;
    }
});