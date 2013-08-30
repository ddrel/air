'use strict';

var π = Math.PI;

/**
 * Maps the point (x, y) to index i into an HTML5 canvas image data array (row-major layout, each
 * pixel being four consecutive elements: [..., Ri, Gi+1, Bi+2, Ai+3, ...]).
 */
function pixelIndex(x, y, width) {
    return (y * width + x) * 4;
}

/**
 * Returns the distance between two points (x1, y1) and (x2, y2).
 */
function distance(x0, y0, x1, y1) {
    var Δx = x0 - x1;
    var Δy = y0 - y1;
    return Math.sqrt(Δx * Δx + Δy * Δy);
}

function masker(canvas) {
    var data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    var width = canvas.width;
    return function(x, y) {
        var i = pixelIndex(x, y, width);
        return 0 <= i && i < data.length && data[i] > 0;
    }
}

var width = 1024, height = 768;

var projection;  // ugh. global to this script, but assigned asynchronously
var done = false;

var mapSvg = d3.select("#map-svg").attr("width", width).attr("height", height);
var fieldCanvas = d3.select("#field-canvas").attr("width", width).attr("height", height)[0][0];

var c = fieldCanvas;
var g = c.getContext("2d");

d3.select("#field-canvas").on("click", printCoord);

function loadJson(resource) {
    var d = when.defer();
    d3.json(resource, function(error, result) {
        if (error) {
            d.reject(error);
        }
        else {
            d.resolve(result);
        }
    });
    return d.promise;
}

function render(width, height, appendTo) {
    var div = document.createElement("div");
    var svg = document.createElement("svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    div.appendChild(svg);

    appendTo(d3.select(svg));

    var canvas = document.createElement("canvas");
    canvas.setAttribute("width", width);
    canvas.setAttribute("height", height);
    canvg(canvas, div.innerHTML.trim());
    return canvas;
}

function plotCurrentPosition(svg, projection) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                var p = projection([position.coords.longitude, position.coords.latitude]);
                var x = Math.round(p[0]);
                var y = Math.round(p[1]);
                if (0 <= x && x < width && 0 <= y && y < height) {
                    svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 3).attr("id", "pos");
                }
            },
            console.error,
            {enableHighAccuracy: true});
    }
}

loadJson("tk-topo.json").then(doProcess, console.error);

function doProcess(tk) {
//    console.time("building meshes");
    var bbox = tk.bbox;
    var outerBoundary = topojson.mesh(tk, tk.objects.tk, function(a, b) { return a === b; });
    var divisionBoundaries = topojson.mesh(tk, tk.objects.tk, function (a, b) { return a !== b; });
    document.getElementById("detail").innerHTML += "⁂ " + bbox.join(", ");

    var path;

    var bboxCenter = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];  // not going to work if crossing 180th meridian
    // Create a unit projection.
    projection = d3.geo.albers()
        .center([0, bboxCenter[1]])
        .rotate([-bboxCenter[0], 0])
        .scale(1)
        .translate([0, 0]);

    // Create a path generator.
    path = d3.geo.path().projection(projection);

    // Compute the bounds of a feature of interest, then derive scale & translate.
    var b = path.bounds(outerBoundary);
    var s = .95 / Math.max((b[1][0] - b[0][0]) / width, (b[1][1] - b[0][1]) / height);
    var t = [(width - s * (b[1][0] + b[0][0])) / 2, (height - s * (b[1][1] + b[0][1])) / 2];

    // Update the projection to use computed scale & translate.
    projection.scale(s).translate(t);
//    console.timeEnd("building meshes");

//    console.time("rendering map");
    mapSvg.append("path")
        .datum(outerBoundary)
        .attr("class", "tk-outboundary")
        .attr("d", path);
    mapSvg.append("path")
        .datum(divisionBoundaries)
        .attr("class", "tk-inboundary")
        .attr("d", path);
//    console.timeEnd("rendering map");

//    console.time("mask render: 1");
    var displayMask = masker(
        render(width, height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", "2")
                .attr("stroke", "#000")
                .attr("d", path);
        }));
//    console.timeEnd("mask render: 1");

//    console.time("mask render: 2");
    var fieldMask = masker(
        render(width, height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", "30")  // FF does NOT like a large number here--even canvg is slow
                .attr("stroke", "#fff")
                .attr("d", path);
        }));
//    console.timeEnd("mask render: 2");

    plotCurrentPosition(mapSvg, projection);

    loadJson("stations/geo").then(function(stations) {
        path.pointRadius(1);
        mapSvg.append("path")
            .datum(stations)
            .attr("class", "station")
            .attr("d", path);

//        var resource = "samples/2013/8/24/16"
//        var resource = "samples/2013/8/21/15"
//        var resource = "samples/2013/8/20/22"
//        var resource = "samples/2013/8/20/20"
//        var resource = "samples/2013/8/20/18"
//        var resource = "samples/2013/8/19/16"
//        var resource = "samples/2013/8/18/17"  // strong northerly wind
//        var resource = "samples/2013/8/17/17"
//        var resource = "samples/2013/8/16/15"
//        var resource = "samples/2013/8/12/19"  // max wind at one station
//        var resource = "samples/2013/8/27/12"  // gentle breeze
//        var resource = "samples/2013/8/26/29"
//        var resource = "samples/2013/8/30/11" // wind reversal in west, but IDW doesn't see it
        var resource = "samples/current";

        interpolateVectorField(resource, displayMask, fieldMask).then(processVectorField);
//            interpolateScalarField(resource, "no2", mask);
    }).then(null, console.error);
}

function printCoord() {
    var m = d3.mouse(this);
    console.log(JSON.stringify(m));
    console.log(JSON.stringify(projection.invert(m)));
    done = true;
}

function weight(x1, y1, x2, y2) {
    var d = distance(x1, y1, x2, y2);
    return 1 / (d * d);
}

function multiply(x, y) {
    return x * y;
}

function add(x, y) {
    return x + y;
}

function vectorScale(v, m) {
    v[1] *= m;
    return v;
}

function vectorAdd(a, b) {
    var ax = Math.cos(a[0]) * a[1];
    var ay = Math.sin(a[0]) * a[1];
    var bx = Math.cos(b[0]) * b[1];
    var by = Math.sin(b[0]) * b[1];

    var cx = ax + bx;
    var cy = ay + by;

    var r = Math.atan2(cy, cx);
    var m = Math.sqrt(cx * cx + cy * cy);

    if (!isFinite(r)) {
        r = 0;
    }
    a[0] = r;
    a[1] = m;
    return a;
}

var temp = [];  // HACK
function f(x, y, initial, data, scale, add) {
    var n = initial;
    var d = 0;
    for (var i = 0; i < data.length; i++) {
        var sample = data[i];
        var value = sample[2];
        var w = weight(x, y, sample[0], sample[1]);
        if (w === Number.POSITIVE_INFINITY) {
            return value;
        }
        temp[0] = value[0];  // DOESN'T WORK FOR SCALARS
        temp[1] = value[1];
        var s = scale(temp, w);
        n = add(n, s);
        d += w;
    }
    return scale(n, 1 / d);
}

//function interpolateScalarField(resource, sampleType, mask) {
//    d3.json(resource, function(error, samples) {
//        var values = [];
//        samples.forEach(function(sample) {
//            if (sample[sampleType]) {
//                values.push([sample.longitude * 1, sample.latitude * 1, sample[sampleType] * 1]);
//            }
//        });
//        var field = [];
//        var min = Number.POSITIVE_INFINITY;
//        var max = Number.NEGATIVE_INFINITY;
//        for (var x = width; x >= 350; x--) {
//            field[x] = [];
//            for (var y = height; y >= 150; y--) {
//                var p = projection.invert([x, y]);
//                var v = f(p[0], p[1], 0, values, multiply, add);
//                field[x][y] = v;
//                if (v < min) {
//                    min = v;
//                }
//                if (v > max) {
//                    max = v;
//                }
//            }
//        }
//    });
//
//    function processScalarField(field, min, max, mask) {
//        var styles = [];
//        for (var i = 0; i < 255; i += 1) {
//            styles.push("rgba(" + i + ", " + i + ", " + i + ", 0.6)");
//        }
//        var range = max - min;
//
//        for (var x = 350; x < width; x+=1) {
//            for (var y = 150; y < height; y+=1) {
//                if (mask(x, y)) {
//                    var v = field[x][y];
//                    var style = styles[Math.floor((v-min)/range * (styles.length-1))];
//                    g.fillStyle = style;
//                    g.fillRect(x, y, 1, 1);
//                }
//            }
//        }
//    }
//}

function displayTimestamp(isoDate) {
    document.getElementById("detail").textContent += " ⁂ " + isoDate;
}

function randomPoint(field) {
    var x;
    var y;
    var i = 30;
    do {
        x = Math.floor(Math.random() * (width - 1));
        y = Math.floor(Math.random() * (height - 1));
        if (--i == 0) {  // UNDONE: remove this check. make better.
            console.log("fail");
            return [Math.floor(width / 2), Math.floor(height / 2)];
        }
    } while (vectorAt(field, x, y) === noVector);
    return [x, y];
}

var noVector = [0, 0, -1];

function interpolateVectorField(resource, displayMask, fieldMask) {
    var d = when.defer();

    loadJson(resource).then(function(samples) {
        // Convert cardinal (north origin, clockwise) to radians (counter-clockwise)

        if (samples.length > 0) {
            displayTimestamp(samples[0].date);
        }

        var vectors = [];
        samples.forEach(function(sample) {
            if (sample.wd && sample.wv) {
                var r = sample.wd / 180 * π;
                vectors.push([
                    sample.longitude * 1,
                    sample.latitude * 1,
                    [Math.atan2(Math.cos(r), Math.sin(r)), sample.wv * 1]]);
            }
        });

        var field = [];
        for (var x = 0; x < width; x++) {
            var column = field[x] = [];
            for (var y = 0; y < height; y++) {
                var v = noVector;
                if (fieldMask(x, y)) {
                    var p = projection.invert([x, y]);
                    var px = p[0];
                    var py = p[1];
                    p[0] = 0;
                    p[1] = 0;
                    v = f(px, py, p, vectors, vectorScale, vectorAdd);
                    var r = v[0];
                    var m = v[1];
                    v[0] = Math.cos(r + π) * m;
                    v[1] = -Math.sin(r + π) * m;
                    v[2] = displayMask(x, y) ? m : -1;
                }
                column[y] = v;
            }
        }
        d.resolve(field);
    }).then(null, console.error);

    return d.promise;
}

function vectorAt(field, x, y) {
    var column = field[x];
    if (column) {
        var v = column[y];
        if (v) {
            return v;
        }
    }
    return noVector;
}

function processVectorField(field) {
    var particles = [];
    var maxAge = 30;

    for (var i = 0; i < 5000; i++) {
        var p = randomPoint(field);
        particles.push({
            x: p[0],
            y: p[1],
            age: Math.floor(Math.random() * maxAge),
            fx: 0,
            fy: 0,
            fxt: 0,
            fyt: 0
        });
    }

    var styles = [];
    for (var j = 75; j <= 255; j += 6) {
        styles.push("rgba(" + j + ", " + j + ", " + j + ", 1)");
    }
    var max = 17;
    var min = 0;
    var range = max - min;

    draw();

    function draw() {
        var prev = g.globalCompositeOperation;
        g.fillStyle = "rgba(0, 0, 0, 0.93)";
        g.globalCompositeOperation = "destination-in";
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = prev;

        g.lineWidth = 0.75;
        var buckets = [];
        for (var i = 0; i < styles.length; i++) {
            buckets[i] = [];
        }

        particles.forEach(function(particle) {
            if (particle.age > maxAge) {
                particle.age = 0;
                var p = randomPoint(field);
                particle.x = p[0];
                particle.y = p[1];
            }

            // get vector at current location
            var x = particle.x;
            var y = particle.y;
            var fx = Math.round(x);
            var fy = Math.round(y);

            var v = vectorAt(field, fx, fy);
            if (v !== noVector) {
                var xt = x + v[0];
                var yt = y + v[1];
                var fxt = Math.round(xt);
                var fyt = Math.round(yt);
                var m = v[2];

                if (m >= 0 && vectorAt(field, fxt, fyt)[2] >= 0) {
                    var i = Math.floor((Math.min(m, max) - min) / range * (styles.length - 1));
                    particle.fx = fx;
                    particle.fy = fy;
                    particle.fxt = fxt;
                    particle.fyt = fyt;
                    buckets[i].push(particle);
                }
                particle.x = xt;
                particle.y = yt;
            }
            particle.age += 1;
        });

        buckets.forEach(function(bucket, i) {
            if (bucket.length > 0) {
                g.beginPath();
                g.strokeStyle = styles[i];
                bucket.forEach(function(particle) {
//                    g.fillStyle = style; //"rgba(255, 255, 255, 1)";
//                    g.fillRect(round(xt), round(yt), 1, 1);
                    g.moveTo(particle.fx, particle.fy);
                    g.lineTo(particle.fxt, particle.fyt);
                })
                g.stroke();
            }
        });

        if (!done) {
            setTimeout(draw, 35);
        }
    }
}

