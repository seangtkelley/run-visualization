queue()
    .defer(d3.json, "/data/load")
    .await(makeGraphs);

function makeGraphs(error, recordsJson) {
	
	//Clean data
	var records = recordsJson;
	var dateFormat = d3.time.format("%Y-%m-%d %H:%M:%S");
	
	var max_speed = 0.0, min_speed = 9999.0;
	records.forEach(function(d) {
		d["timestamp"] = dateFormat.parse(d["timestamp"]);
		d["timestamp"].setSeconds(0);
		if(d['speed'] > max_speed){
			max_speed = d['speed'];
		} else if(d['speed'] < min_speed){
			min_speed = d['speed'];
		}
	});

	//Create a Crossfilter instance
	var ndx = crossfilter(records);

	//Define Dimensions
	var dateDim = ndx.dimension(function(d) { return d["timestamp"]; });
	var todDim = ndx.dimension(function(d) { return d["hour"]; });
	var dowDim = ndx.dimension(function(d) { return d["dow"]; });

	var locationDim = ndx.dimension(function(d) { return d["location"]; });

	// var paceDim = ndx.dimension(function(d) { return d["run_avg_pace"]; });
	// var distDim = ndx.dimension(function(d) { return d["run_distance"]; });
	// var durDim = ndx.dimension(function(d) { return d["run_duration"]; });

	var allDim = ndx.dimension(function(d) {return d;});


	//Group Data
	var numRecordsByDate = dateDim.group();
	var todGroup = todDim.group();
	var dowGroup = dowDim.group();
	var locationGroup = locationDim.group();
	// var paceGroup = paceDim.group(function(d) { return 60 * Math.floor(d["run_avg_pace"]/60); });
	var all = ndx.groupAll();

	//Define values (to be used in charts)
	var minDate = dateDim.bottom(1)[0]["timestamp"];
	var maxDate = dateDim.top(1)[0]["timestamp"];

    //Charts
    var numberRecordsND = dc.numberDisplay("#number-records-nd");
	var timeChart = dc.barChart("#time-chart");
	var todChart = dc.rowChart("#tod-row-chart");
	var dowChart = dc.rowChart("#dow-row-chart");
	var locationChart = dc.rowChart("#location-row-chart");
	// var paceChart = dc.rowChart("#pace-row-chart");

	numberRecordsND
		.formatNumber(d3.format("d"))
		.valueAccessor(function(d){return d; })
		.group(all);


	timeChart
		.width(document.getElementById('time-chart').parentNode.offsetWidth)
		.height(140)
		.margins({top: 10, right: 50, bottom: 20, left: 20})
		.dimension(dateDim)
		.group(numRecordsByDate)
		.transitionDuration(500)
		.x(d3.time.scale().domain([minDate, maxDate]))
		.elasticY(true)
		.yAxis().ticks(4);

	todChart
		.width(document.getElementById('tod-row-chart').parentNode.offsetWidth)
		.height(500)
        .dimension(todDim)
        .group(todGroup)
        .ordering(function(d) { return d.key })
        .colors(['#6baed6'])
        .elasticX(true)
        .xAxis().ticks(4);

	dowChart
		.width(document.getElementById('dow-row-chart').parentNode.offsetWidth)
        .height(250)
        .dimension(dowDim)
        .group(dowGroup)
        .ordering(function(d) { return d.key })
        .colors(['#6baed6'])
        .elasticX(true)
		.xAxis().ticks(4);
	
	locationChart
		.width(document.getElementById('location-row-chart').parentNode.offsetWidth)
        .height(250)
        .dimension(locationDim)
        .group(locationGroup)
        .ordering(function(d) { return -d.value })
        .colors(['#6baed6'])
        .elasticX(true)
		.xAxis().ticks(4);

	// paceChart
    // 	.width(document.getElementById('pace-row-chart').parentNode.offsetWidth)
	// 	.height(300)
	// 	.xUnits(dc.units.fp.precision(60))
    //     .dimension(paceDim)
    //     .group(paceGroup)
    //     .colors(['#6baed6'])
	// 	.elasticX(true)
	// 	.xAxis().ticks(4);


    var map = L.map('map');

	var drawMap = function(){

	    map.setView([42.387, -72.525], 8);
		mapLink = '<a href="http://openstreetmap.org">OpenStreetMap</a>';
		L.tileLayer(
			'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '&copy; ' + mapLink + ' Contributors',
				maxZoom: 20,
			}).addTo(map);

		//HeatMap
		var geoData = [];
		_.each(allDim.top(Infinity), function (d) {
			geoData.push([d["lat"], d["lon"], 1-(d["speed"]-min_speed)/(max_speed - min_speed)]);
		});
		var heat = L.heatLayer(geoData,{
			minOpacity: 0.25,
			radius: 3,
			blur: 5,
		}).addTo(map);
	};

	//Draw Map
	drawMap();

	//Update the heatmap if any dc chart get filtered
	dcCharts = [timeChart, todChart, dowChart, locationChart]

	_.each(dcCharts, function (dcChart) {
		dcChart.on("filtered", function (chart, filter) {
			map.eachLayer(function (layer) {
				map.removeLayer(layer)
			}); 
			drawMap();
		});
	});

	dc.renderAll();

};