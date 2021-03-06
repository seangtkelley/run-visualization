queue()
    .defer(d3.json, "/data/load")
    .await(makeGraphs);

function makeGraphs(error, recordsJson) {
	
	//Clean data
	var records = recordsJson;
	var dateFormat = d3.time.format("%Y-%m-%d %H:%M:%S");
	
	records.forEach(function(d) {
		d["timestamp"] = dateFormat.parse(d["timestamp"]);
		d["timestamp"].setSeconds(0);
	});

	//Create a Crossfilter instance
	var ndx = crossfilter(records);

	//Define Dimensions
	var dateDim = ndx.dimension(function(d) { return d["timestamp"]; });
	var todDim = ndx.dimension(function(d) { return d["hour"]; });
	var dowDim = ndx.dimension(function(d) { return d["dow"]; });
	var locationDim = ndx.dimension(function(d) { return d["location"]; });
	var paceDim = ndx.dimension(function(d) { return d["run_avg_pace"]; });
	var distDim = ndx.dimension(function(d) { return d["run_distance"]; });
	var durDim = ndx.dimension(function(d) { return d["run_duration"]; });
	var allDim = ndx.dimension(function(d) {return d;});


	//Group Data
	var numRecordsByDate = dateDim.group();
	var todGroup = todDim.group();
	var dowGroup = dowDim.group();
	var locationGroup = locationDim.group();
	var paceGroup = paceDim.group();
	var distGroup = distDim.group();
	var durGroup = durDim.group();
	var all = ndx.groupAll();

	//Define values (to be used in charts)
	var minDate = dateDim.bottom(1)[0]["timestamp"];
	var maxDate = dateDim.top(1)[0]["timestamp"];

    //Charts
    var numberRecordsND = dc.numberDisplay("#number-records-nd");
	var timeChart = dc.barChart("#time-chart");
	var todChart = dc.rowChart("#tod-chart");
	var dowChart = dc.rowChart("#dow-chart");
	var locationChart = dc.rowChart("#location-chart");
	var paceChart = dc.rowChart("#pace-chart");
	var distChart = dc.rowChart("#distance-chart");
	var durChart = dc.rowChart("#duration-chart");

	numberRecordsND
		.formatNumber(d3.format("d"))
		.valueAccessor(function(d){return d; })
		.group(all);


	timeChart
		.width($('#time-chart').parent().width())
		.height(140)
		.margins({top: 10, right: 50, bottom: 20, left: 20})
		.dimension(dateDim)
		.group(numRecordsByDate)
		.transitionDuration(500)
		.x(d3.time.scale().domain([minDate, maxDate]))
		.elasticY(true)
		.yAxis().ticks(4);

	todChart
		.width($('#tod-chart').parent().width())
		.height(590)
        .dimension(todDim)
        .group(todGroup)
        .ordering(function(d) { return d.key })
        .colors(['#6baed6'])
        .elasticX(true)
        .xAxis().ticks(4);

	dowChart
		.width($('#dow-chart').parent().width())
        .height(250)
        .dimension(dowDim)
        .group(dowGroup)
        .ordering(function(d) { return d.key })
        .colors(['#6baed6'])
        .elasticX(true)
		.xAxis().ticks(4);
	
	locationChart
		.width($('#location-chart').parent().width())
        .height(250)
        .dimension(locationDim)
        .group(locationGroup)
        .ordering(function(d) { return -d.value })
        .colors(['#6baed6'])
        .elasticX(true)
		.xAxis().ticks(4);

	paceChart
		.width($('#pace-chart').parent().width())
		.height(250)
		.dimension(paceDim)
		.group(paceGroup)
		.ordering(function(d) { return parseFloat(d.key.split(',')[0].replace('(', '')) })
		.colors(['#6baed6'])
		.elasticX(true)
		.xAxis().ticks(4);

	distChart
		.width($('#distance-chart').parent().width())
		.height(250)
		.dimension(distDim)
		.group(distGroup)
		.ordering(function(d) { return parseFloat(d.key.split(',')[0].replace('(', '')) })
		.colors(['#6baed6'])
		.elasticX(true)
		.xAxis().ticks(4);

	durChart
		.width($('#duration-chart').parent().width())
		.height(280)
		.dimension(durDim)
		.group(durGroup)
		.ordering(function(d) { return parseFloat(d.key.split(',')[0].replace('(', '')) })
		.colors(['#6baed6'])
		.elasticX(true)
		.xAxis().ticks(4);


	var map = L.map('map');
	map.setView([42.648153, -71.843778], 9);

	var coordSpeedSums = {};
	var coordSpeedCounts = {};
	var maxSpeed = -9999;
	var minSpeed = 9999;

	async function calcSums(){
		// init vars
		coordSpeedSums = {};
		coordSpeedCounts = {};
		maxSpeed = -9999;
		minSpeed = 9999;

		_.each(allDim.top(Infinity), function (d) {
			// convert to web mercator: lon,lat
			var webMercCoords = proj4("EPSG:4326", 'EPSG:3857', [d['lon'], d['lat']]);

			// round to nearest 10: lon,lat
			var roundedWebMercCoords = [Math.round(webMercCoords[0] / 10) * 10, Math.round(webMercCoords[1] / 10) * 10];

			// convert back: lon,lat
			var roundedWgsCoords = proj4("EPSG:3857", "EPSG:4326", roundedWebMercCoords);

			// create string for point: lat,lon
			var coord_wkt = roundedWgsCoords[1].toString()+","+roundedWgsCoords[0].toString();

			// add to hash map
			coordSpeedSums[coord_wkt] = (coordSpeedSums[coord_wkt] || 0) + d["speed"];
			coordSpeedCounts[coord_wkt] = (coordSpeedCounts[coord_wkt] || 0) + 1;

			// record max and min
			maxSpeed = (d["speed"] > maxSpeed) ? d["speed"] : maxSpeed;
			minSpeed = (d["speed"] < minSpeed) ? d["speed"] : minSpeed;
		});
		return;
	};

	// palettes from Bokeh: https://bokeh.pydata.org/en/latest/docs/reference/palettes.html
	var plasma4 = [
		[ 0, [12, 7, 134] ],
		[ 0.33, [155, 23, 158] ],
		[ 0.66, [236, 120, 83] ],
		[ 1.0, [239, 248, 33] ]
	];
	
	var viridis5 = [
		[ 0, [68, 1, 84] ],
		[ 0.25, [59, 81, 138] ],
		[ 0.50, [32, 143, 140] ],
		[ 0.75, [91, 200, 98] ],
		[ 1.0, [253, 231, 36] ]
	];

	function displayColorGradient(gradient){
		htmlStr = '<div style="height: 44.5px; background: linear-gradient(to right,';
		for(var i = 0; i < gradient.length; i++){
			htmlStr += 'rgb('+gradient[i][1].join()+')';
			if (i != gradient.length-1){
				htmlStr += ', ';
			}
		}
		htmlStr += ')"></div>';
		$('#color-gradient').html(htmlStr);
	}

	function pickHex(color1, color2, weight) {
		var p = weight;
		var w = p * 2 - 1;
		var w1 = (w/1+1) / 2;
		var w2 = 1 - w1;
		var rgb = [Math.round(color1[0] * w1 + color2[0] * w2),
			Math.round(color1[1] * w1 + color2[1] * w2),
			Math.round(color1[2] * w1 + color2[2] * w2)];
		return rgb;
	}

	function getColorFromVal(val, min, max, gradient){
		// get speed as ratio of distribution of speeds
		var ratio = (val-min)/(max-min);

		var colorRange = []
        $.each(gradient, function( index, value ) {
            if(ratio < value[0]) {
                colorRange = [index-1,index]
                return false;
            }
        });
        
        //Get the two closest colors
        var firstcolor = gradient[colorRange[0]][1];
		var secondcolor = gradient[colorRange[1]][1];
        
        //Calculate ratio between the two closest colors
		var innerRatio = ratio/gradient[colorRange[1]][0];
        
        //Get the color with pickHex(thx, less.js's mix function!)
		return pickHex( secondcolor, firstcolor, innerRatio );
	}

	var drawMap = async function(){

		mapLink = '<a href="http://openstreetmap.org">OpenStreetMap</a>';
		L.tileLayer(
			'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '&copy; ' + mapLink + ' Contributors',
				maxZoom: 20,
			}).addTo(map);

		// wait for calculating sums finishes
		await calcSums();

		// display circles
		for (var key in coordSpeedSums) {
			if (coordSpeedSums.hasOwnProperty(key)) {
				var mean = coordSpeedSums[key]/coordSpeedCounts[key];
				var coord = key.split(',');
				var color = "rgb("+getColorFromVal(mean, minSpeed, maxSpeed, viridis5).join()+")";
				L.circle([parseFloat(coord[0]), parseFloat(coord[1])], 2, {
					color: color,
					fillColor: color,
					fillOpacity: 0.5
				}).addTo(map);
			}
		}
	};

	//Draw Map
	drawMap();
	displayColorGradient(viridis5);

	//Update the heatmap if any dc chart get filtered
	dcCharts = [timeChart, todChart, dowChart, locationChart, paceChart, distChart, durChart]

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