var Line = new Meteor.Collection("line");

var stops = [];

if (Meteor.isClient) {
  Session.set("line", "L2");
  Session.set("direction", "Ski");

  Template.train.stops = function () {
    stops = [];
        console.log("log-client :"  - Session.get("Line") + ":" +  Session.get("direction"));
    var line = Line.findOne({lineNo:Session.get("line"), destination:Session.get("direction")})
        console.log(line);
    if(line !== undefined && line.stops != undefined){
        console.log("log-client :Found some stops");
      return line.stops
    }
  };
  
   
  var addOption = function(select, text){
        console.log("log-client :Adding options : " + text);
            var option = document.createElement("option");
            option.text = text;
            option.value = text;
            select.appendChild(option);
  }


  Template.train.events({
    'change #line' : function(event){
        console.log("log-client : Changing line");
        var selectLineBox = document.getElementById("line");
        var selectedLine = selectLineBox.options[selectLineBox.selectedIndex].text;
        var selectDirectionBox = document.getElementById("direction");        
        selectDirectionBox.options.length = 0;
        console.log("log-client :Adding options.")
        
        if(selectedLine==="L2"){
            addOption(selectDirectionBox,"Ski");
            addOption(selectDirectionBox,"Skøyen");
        } else if(selectedLine==="L3"){
            addOption(selectDirectionBox,"Jaren");
            addOption(selectDirectionBox,"Oslo S");
        } else if(selectedLine==="L12"){
            addOption(selectDirectionBox,"Kongsberg");
            addOption(selectDirectionBox,"Eidsvoll");
        } else if(selectedLine==="L13"){
            addOption(selectDirectionBox,"Dal");
            addOption(selectDirectionBox,"Drammen");
        } else if(selectedLine==="L14"){
            addOption(selectDirectionBox,"Kongsvinger");
            addOption(selectDirectionBox,"Asker");
        } else if(selectedLine==="L21"){
            addOption(selectDirectionBox,"Skøyen");
            addOption(selectDirectionBox,"Moss");
        } else if(selectedLine==="L22"){
            addOption(selectDirectionBox,"Skøyen");
            addOption(selectDirectionBox,"Rakkestad");
        }

        var selectedDirection = selectDirectionBox.options[0].text;
        Session.set("line", selectedLine);
        Session.set("direction", selectedDirection);
    },



    'change #direction' : function(event){
        console.log("log-client :Changing direction");
        var selectBox = document.getElementById("direction");
        var selectedDirection = selectBox.options[selectBox.selectedIndex].text;
        Session.set("direction", selectedDirection);
    }
  })

  
}

if (Meteor.isServer) {

  var cachedCalls = []
  var problemGettingStation = []


  var callRuter = function(stop,stopid){
    var result = findCachedStation(stopid);
    if(result === undefined){
        console.log("log-callRuter():"+ stop + " - http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
      var returnThis;
      try {
        result = HTTP.call("GET", "http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
        cacheStation(stopid,result);
      } catch(err) {
        problemGettingStation.push(stopid);
      }
    } else {
        console.log("log-callRuter(): Using cached result");
    }
    return result;
  };


  var cacheStation = function(stopid,result){
    cachedCalls.push({stopid:stopid,result:result})
  }

  var findCachedStation = function(stopid) {
        console.log("log-findCachedStation(): Looking for cached result.")
    var result;
    if( stopid === undefined ) return undefined;
    for (var i = 0; i < cachedCalls.length; i++) {
        if (cachedCalls[i].stopid  !== undefined && cachedCalls[i].stopid === stopid) {
            result = cachedCalls[i].result;
            break;
        }
    }
    return result;
  }


  var containsTrain = function(a, train) {
    if( train === undefined ) return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i].trainid === train.trainid) {
            return true;
        }
    }
    return false;
  }

  var isInLessThanMinutes = function(minutes, date){
      var inFiveMinutes = new Date(new Date().getTime() + minutes*60000);
      return  date < inFiveMinutes;
  }

  var getTrain = function(lineNo,destination,stopSeq,result){
    var train;
    var earliestDepartureDate;
    if(result === undefined) return undefined

    var obj = JSON.parse(result.content);              
    
    for (var j = 0; j < obj.length; j++) {
      var itIsTheRightTrain = obj[j].ExpectedDepartureTime !== null && obj[j].DestinationName === destination && obj[j].PublishedLineName === lineNo;
      if(itIsTheRightTrain){
        var trainid = obj[j].FramedVehicleJourneyRef.DatedVehicleJourneyRef;
        var departureDate = new Date(parseInt(obj[j].ExpectedDepartureTime.replace("/Date(","").replace("+0200)/","")));
        if(earliestDepartureDate === undefined) { earliestDepartureDate = departureDate }
        if(earliestDepartureDate >= departureDate){
          earliestDepartureDate = departureDate;
          train = {trainid:trainid,lastSeenOn:stopSeq,departureDate:departureDate}
        }
      }
    }

    return train;
  }

  var removeAllTrainsFromStations = function(line){  
      line.stops.forEach(function(stop){          
          stop.status=line.lineNo;
          stop.trainid="";
      });  
      return line;
  }
  
  var makeSureTrainsAreOnLine = function(){
    cachedCalls = [];
        console.log("\n\nlog-makeSureTrainsAreOnLine(): start ");    

      Line.find({ trains: { $size: 0 } }).forEach(function(line){
        console.log("Line " +  line.lineNo+  " has 0 trains on it. Will make sure to update it. Trains size: " + line.trains.length );
        try {
          updateLine(line.lineNo,line.destination);
        } catch(err){
        console.log(err);
        }
      });
      cachedCalls = [];
        console.log("\n\nlog-makeSureTrainsAreOnLine(): stop ");   
  }


  var updateLine = function(lineNo,destination) {      
        var trains = [];
        var firstTrain;
        console.log("\n\nlog-updateLine(): start " + lineNo + " - " + destination);    
        
        var line = removeAllTrainsFromStations(Line.findOne({lineNo:lineNo, destination:destination}));        
        for (var i = 0; i < line.stops.length; i++) {
          var station = line.stops[i];
          var result = callRuter(station.stop,station.stopid);
          if(result === undefined ) { station.status="red"; continue; };

          var train = getTrain(lineNo,destination,i,result);
          if(firstTrain === undefined){ firstTrain = train }

          if(train !== undefined && train.trainid !== undefined){
            if(i === 0 && train.trainid === firstTrain.trainid && isInLessThanMinutes(5,firstTrain.departureDate) && containsTrain(trains, train) === false){
        console.log("log-updateLine(): New train added. Starting from start station. "+ train.trainid +" on station : " + station.stop);
              trains.push(train);
              station.status="train";              
            } else if(containsTrain(trains, train) === false && train.trainid !== firstTrain.trainid){
        console.log("log-updateLine(): Train "+ train.trainid +" on station : " + station.stop);
              trains.push(train);
              station.status="train";
            } else {
        console.log("log-updateLine(): No train on station : " + station.stop);
            }        
          }
        }
        line.trains = trains;
        Line.update({_id:line._id},line);
        console.log("log-updateLine(): stop "  + lineNo + " - " + destination + "\n\n");    
        reportProblems();
  }


  var updateTrains = function(){
    cachedCalls = [];
    try {
    
    console.log("\n\nlog-updateTrains(): start");
    var lines = Line.find({});
    console.log("Found " + lines.count() + " lines with trains" );
      lines.forEach(function(line){
      var line = removeAllTrainsFromStations(line);

      console.log("log-updateTrains(): "+ line.lineNo + " - " + line.destination + " line.trains ->  " + line.trains.length);
      for (var i = 0; i < line.trains.length; i++) {
          var train =  line.trains[i];

          var lastSeenStop = line.stops[train.lastSeenOn];
          var nextStop = line.stops[train.lastSeenOn+1];



        console.log("log-updateTrains(): Train " + train.trainid + " - which was last seen on " + lastSeenStop.stop);
        console.log("log-updateTrains(): line.stops.length =" + line.stops.length+" and train.lastSeenOn =" + train.lastSeenOn)

        var handled = false;


          if((line.stops.length -1) === train.lastSeenOn) {
              console.log("log-updateTrains(): Was last seen on last station. removing.\n");
              var t = []
              for (var p = 0; p < line.trains.length; p++) {
                if(line.trains[p].trainid !==train.trainid){
                  t.push(p);
                }
              };
            line.trains = t;
            handled = true;
          } else {

          var theTrainHasMoved = false;
          var thisStationResult = callRuter(lastSeenStop.stop ,lastSeenStop.stopid)

          // Is the train on this station?
          if(thisStationResult !== undefined){
           theTrainHasMoved = trainIsOnTheStation(train,thisStationResult);
          }

          if(!theTrainHasMoved && line.stops.length !== train.lastSeenOn) {
            console.log("log-updateTrains(): !theTrainHasMoved.")
            lastSeenStop.status="train";
            lastSeenStop.trainid=train.trainid;
            handled = true;
          } else if(theTrainHasMoved && line.stops.length !== train.lastSeenOn) {
              console.log("log-updateTrains(): theTrainHasMoved. checking next station.")
               var nextStationResult = callRuter( nextStop.stop ,nextStop.stopid)
               if(nextStationResult === undefined || trainIsOnTheStation(train,nextStationResult)){
                  train.lastSeenOn++; 
                  nextStop.status="train";
                  nextStop.trainid=train.trainid;
                  if(nextStationResult === undefined){
                    console.log("log-updateTrains(): ruter did not answer. will manually register on next station.\n");
                  } else {
                    console.log("log-updateTrains(): it is on the next station.\n");
                  }
                
                  handled = true;
                }  
          } else {
            console.log("log-updateTrains(): Train should have been, but isn't at the next stop.\n");
          }

         // If not, where can it be?
          // if there was a problem getting the station, maybe we can say next station anyway?
          //} else if(){
          }
          }      
      Line.update({_id:line._id},line);

      if(handled === false) { 
        console.log("\n\nThings weren't handled properly. Reloading the whole line.")

        updateLine(line.lineNo,line.destination);
      }

    });
        console.log("log-updateTrains(): stop\n\n");

  } catch(err) {}

    reportProblems();
    cachedCalls =[];
  }

 
  var initLines = function(){

    cachedCalls = [];
        console.log("\n\nlog-initLines(): start Initiating lines");

    updateLine('L2','Skøyen');
    updateLine('L2','Ski');

    updateLine('L3','Oslo S');
    updateLine('L3','Jaren');

    updateLine('L12','Kongsberg');
    updateLine('L12','Eidsvoll');

    updateLine('L13','Drammen');
    updateLine('L13','Dal');

    updateLine('L14','Asker');
    updateLine('L14','Kongsvinger');

    updateLine('L21','Moss');
    updateLine('L21','Skøyen');

    updateLine('L22','Rakkestad');
    updateLine('L22','Skøyen');

    cachedCalls = [];
    reportProblems();
        console.log("log-initLines(): stop Initiating lines\n\n");
  }

  var reportProblems = function(){
    problemGettingStation.forEach(function(problem){
        console.log("log-reportProblems(): Problem getting stop id :" + problem)
    });
    problemGettingStation = [] // <-- do this for now. should really use this information to improve data quality
  }

  var trainIsOnTheStation = function(train,result){ 
    if(result !== undefined ){
      var obj = JSON.parse(result.content);              
      for (var t = 0; t < obj.length; t++) {
          if(train.trainid == obj[t].FramedVehicleJourneyRef.DatedVehicleJourneyRef){
            return true;
          }
      }
    }
    return false;
  }


  var registerNewTrains = function(){
      cachedCalls = [];
      try{
        console.log("\n\nlog-registerNewTrains(): start");
        Line.find({}).forEach(
          function(line){
            var result = callRuter(line.stops[0].stop,line.stops[0].stopid);
            var train = getTrain(line.lineNo,line.destination,0,result);
            if(train === undefined ){
        console.log("log-registerNewTrains(): Train was not found at stop " + line.stops[0].stop);
            } else if(train !== undefined && isInLessThanMinutes(5,train.departureDate) && containsTrain(line.trains, train) === false){
        console.log("log-registerNewTrains(): New train added. Starting from start station. "+ train.trainid +" on station : " + line.stops[0].stop + " Leaving at " +train.departureDate );
                  line.trains.push(train);
                  line.stops[0].status="train";              
                  Line.update({_id:line._id},line);
            }
          }
        );
      } catch(err){
        console.log("\n\nlog-registerNewTrains(): failed : " + err);
      }
        console.log("\n\nlog-registerNewTrains(): stop");
    cachedCalls = [];
  }
  
  Meteor.setTimeout(initLines, 5000); // Find all trains initially  
  Meteor.setInterval(registerNewTrains, 4 * 60000); // Add new trains to track
  Meteor.setInterval(makeSureTrainsAreOnLine, 10 * 60000); // Add new trains to track
  Meteor.setInterval(updateTrains, 60000); // Update location of previously tracked trains.


  Meteor.startup(function () {
    Line.remove({});
    Line.insert({
      'lineNo' : 'L2',
      'destination' :'Ski',
      'trains': [],
      'stops' : [
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nordstrand',stopid:3010810,status:'',trainid:''},
        {stop:'Ljan',stopid:3010820,status:'',trainid:''},
        {stop:'Hauketo',stopid:3010910,status:'',trainid:''},
        {stop:'Holmlia',stopid:3010920,status:'',trainid:''},
        {stop:'Rosenholm',stopid:3010930,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Solbråtan',stopid:2170200,status:'',trainid:''},
        {stop:'Myrvoll',stopid:2170500,status:'',trainid:''},
        {stop:'Greverud',stopid:2170300,status:'',trainid:''},
        {stop:'Oppegård',stopid:2170400,status:'',trainid:''},
        {stop:'Vevelstad',stopid:2130700,status:'',trainid:''},
        {stop:'Langhus',stopid:2130500,status:'',trainid:''},
        {stop:'Ski',stopid:2130300,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L2',
      'destination' :'Skøyen',
      'trains': [],
      'stops' : [
        {stop:'Ski',stopid:2130300,status:'',trainid:''},
        {stop:'Langhus',stopid:2130500,status:'',trainid:''},
        {stop:'Vevelstad',stopid:2130700,status:'',trainid:''},
        {stop:'Oppegård',stopid:2170400,status:'',trainid:''},
        {stop:'Greverud',stopid:2170300,status:'',trainid:''},
        {stop:'Myrvoll',stopid:2170500,status:'',trainid:''},
        {stop:'Solbråtan',stopid:2170200,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Rosenholm',stopid:3010930,status:'',trainid:''},
        {stop:'Holmlia',stopid:3010920,status:'',trainid:''},
        {stop:'Hauketo',stopid:3010910,status:'',trainid:''},
        {stop:'Ljan',stopid:3010820,status:'',trainid:''},
        {stop:'Nordstrand',stopid:3010810,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L3',
      'destination' :'Oslo S',
      'trains': [],
      'stops' : [
      {stop:'Jaren',stopid:5349414,status:'',trainid:''},
      {stop:'Gran',stopid:5349503,status:'',trainid:''},
      {stop:'Lunner',stopid:5339119,status:'',trainid:''},
      {stop:'Roa',stopid:5339212,status:'',trainid:''},
      {stop:'Grua',stopid:5339208,status:'',trainid:''},
      {stop:'Harestua',stopid:5336100,status:'',trainid:''},
      {stop:'Stryken',stopid:5339308,status:'',trainid:''},
      {stop:'Hakadal',stopid:2330170,status:'',trainid:''},
      {stop:'Varingskollen',stopid:2330155,status:'',trainid:''},
      {stop:'Åneby',stopid:2330400,status:'',trainid:''},
      {stop:'Nittedal',stopid:2330100,status:'',trainid:''},
      {stop:'Movatn',stopid:3012680,status:'',trainid:''},
      {stop:'Snippen',stopid:3012675,status:'',trainid:''},
      {stop:'Kjelsås',stopid:3012160,status:'',trainid:''},
      {stop:'Nydalen',stopid:3012125,status:'',trainid:''},
      {stop:'Grefsen',stopid:3012110,status:'',trainid:''},
      {stop:'Tøyen',stopid:3011420,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L3',
      'destination' :'Jaren',
      'trains': [],
      'stops' : [
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Tøyen',stopid:3011420,status:'',trainid:''},
      {stop:'Grefsen',stopid:3012110,status:'',trainid:''},
      {stop:'Nydalen',stopid:3012125,status:'',trainid:''},
      {stop:'Kjelsås',stopid:3012160,status:'',trainid:''},
      {stop:'Snippen',stopid:3012675,status:'',trainid:''},
      {stop:'Movatn',stopid:3012680,status:'',trainid:''},
      {stop:'Nittedal',stopid:2330100,status:'',trainid:''},
      {stop:'Åneby',stopid:2330400,status:'',trainid:''},
      {stop:'Varingskollen',stopid:2330155,status:'',trainid:''},
      {stop:'Hakadal',stopid:2330170,status:'',trainid:''},
      {stop:'Stryken',stopid:5339308,status:'',trainid:''},
      {stop:'Harestua',stopid:5336100,status:'',trainid:''},
      {stop:'Grua',stopid:5339208,status:'',trainid:''},
      {stop:'Roa',stopid:5339212,status:'',trainid:''},
      {stop:'Lunner',stopid:5339119,status:'',trainid:''},
      {stop:'Gran',stopid:5349503,status:'',trainid:''},
      {stop:'Jaren',stopid:5349414,status:'',trainid:''}
    ]
    });

    Line.insert({
      'lineNo' : 'L12',
      'destination' :'Eidsvoll',
      'trains': [],
      'stops' : [
      {stop:'Kongsberg',stopid:6049104,status:'',trainid:''},
      {stop:'Darbu',stopid:6246280,status:'',trainid:''},
      {stop:'Vestfossen',stopid:6246004,status:'',trainid:''},
      {stop:'Hokksund',stopid:6246600,status:'',trainid:''},
      {stop:'Mjøndalen',stopid:6256295,status:'',trainid:''},
      {stop:'Gulskogen',stopid:6029143,status:'',trainid:''},
      {stop:'Drammen',stopid:6021000,status:'',trainid:''},
      {stop:'Asker',stopid:2200500,status:'',trainid:''},
      {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
      {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
      {stop:'Oslo Lufthavn',stopid:2350350,status:'',trainid:''},
      {stop:'Eidsvoll verk',stopid:2370430,status:'',trainid:''},
      {stop:'Eidsvoll',stopid:2370300,status:'',trainid:''}
    ]
    });


    Line.insert({
      'lineNo' : 'L12',
      'destination' :'Kongsberg',
      'trains': [],
      'stops' : [
      {stop:'Eidsvoll',stopid:2370300,status:'',trainid:''},
      {stop:'Eidsvoll verk',stopid:2370430,status:'',trainid:''},
      {stop:'Oslo Lufthavn',stopid:2350350,status:'',trainid:''},
      {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
      {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
      {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
      {stop:'Asker',stopid:2200500,status:'',trainid:''},
      {stop:'Drammen',stopid:6021000,status:'',trainid:''},
      {stop:'Gulskogen',stopid:6029143,status:'',trainid:''},
      {stop:'Mjøndalen',stopid:6256295,status:'',trainid:''},
      {stop:'Hokksund',stopid:6246600,status:'',trainid:''},
      {stop:'Vestfossen',stopid:6246004,status:'',trainid:''},
      {stop:'Darbu',stopid:6246280,status:'',trainid:''},
      {stop:'Kongsberg',stopid:6049104,status:'',trainid:''}
    ]
    });

    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Dal',
      'trains': [],
      'stops' : [
        {stop:'Drammen',stopid:6021000,status:'',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'',trainid:''},
        {stop:'Lier',stopid:6264170,status:'',trainid:''},
        {stop:'Asker',stopid:2200500,status:'',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'',trainid:''},
        {stop:'Dal',stopid:2370600,status:'',trainid:''}
        ]
    });

    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Drammen',
      'trains': [],
      'stops' : [
        {stop:'Dal',stopid:2370600,status:'',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
        {stop:'Asker',stopid:2200500,status:'',trainid:''},
        {stop:'Lier',stopid:6264170,status:'',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'',trainid:''},
        {stop:'Drammen',stopid:6021000,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L14',
      'destination' :'Kongsvinger',
      'trains': [],
      'stops' : [
      {stop:'Asker',stopid:2200500,status:'',trainid:''},
      {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
      {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
      {stop:'Nerdrum',stopid:2270512,status:'',trainid:''},
      {stop:'Fetsund',stopid:2270100,status:'',trainid:''},
      {stop:'Svingen',stopid:2270702,status:'',trainid:''},
      {stop:'Sørumsand',stopid:2260100,status:'',trainid:''},
      {stop:'Blaker',stopid:2260200,status:'',trainid:''},
      {stop:'Rånåsfoss',stopid:2260300,status:'',trainid:''},
      {stop:'Auli',stopid:2360000,status:'',trainid:''},
      {stop:'Haga',stopid:2360100,status:'',trainid:''},
      {stop:'Årnes',stopid:2360300,status:'',trainid:''},
      {stop:'Skarnes',stopid:4190100,status:'',trainid:''},
      {stop:'Kongsvinger',stopid:4020080,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L14',
      'destination' :'Asker',
      'trains': [],
      'stops' : [
      {stop:'Kongsvinger',stopid:4020080,status:'',trainid:''},
      {stop:'Skarnes',stopid:4190100,status:'',trainid:''},
      {stop:'Årnes',stopid:2360300,status:'',trainid:''},
      {stop:'Haga',stopid:2360100,status:'',trainid:''},
      {stop:'Auli',stopid:2360000,status:'',trainid:''},
      {stop:'Rånåsfoss',stopid:2260300,status:'',trainid:''},
      {stop:'Blaker',stopid:2260200,status:'',trainid:''},
      {stop:'Sørumsand',stopid:2260100,status:'',trainid:''},
      {stop:'Svingen',stopid:2270702,status:'',trainid:''},
      {stop:'Fetsund',stopid:2270100,status:'',trainid:''},
      {stop:'Nerdrum',stopid:2270512,status:'',trainid:''},
      {stop:'Lillestrøm',stopid:2310300,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
      {stop:'Lysaker',stopid:3012550,status:'',trainid:''},
      {stop:'Sandvika',stopid:2190400,status:'',trainid:''},
      {stop:'Asker',stopid:2200500,status:'',trainid:''}
      ]
    });




    Line.insert({
      'lineNo' : 'L21',
      'destination' :'Moss',
      'trains': [],
      'stops' : [
        {stop:'Skøyen',stopid:3012500,status:'',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
        {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
        {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
        {stop:'Ski',stopid:2130300,status:'',trainid:''},
        {stop:'Ås',stopid:2140200,status:'',trainid:''},
        {stop:'Vestby',stopid:2110100,status:'',trainid:''},
        {stop:'Sonsveien',stopid:2110300,status:'',trainid:''},
        {stop:'Kambo',stopid:1040200,status:'',trainid:''},
        {stop:'Moss',stopid:1045160,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L21',
      'destination' :'Skøyen',
      'trains': [],
      'stops' : [
      {stop:'Moss',stopid:1045160,status:'',trainid:''},
      {stop:'Kambo',stopid:1040200,status:'',trainid:''},
      {stop:'Sonsveien',stopid:2110300,status:'',trainid:''},
      {stop:'Vestby',stopid:2110100,status:'',trainid:''},
      {stop:'Ås',stopid:2140200,status:'',trainid:''},
      {stop:'Ski',stopid:2130300,status:'',trainid:''},
      {stop:'Kolbotn',stopid:2170100,status:'',trainid:''},
      {stop:'Oslo Sentralstasjon',stopid:3010010,status:'',trainid:''},
      {stop:'Nationaltheatret',stopid:3010030,status:'',trainid:''},
      {stop:'Skøyen',stopid:3012500,status:'',trainid:''}
      ]
    });

    Line.insert({
      'lineNo' : 'L22',
      'destination' :'Skøyen',
      'trains': [],
      'stops' : [
      {stop:"Rakkestad",stopid:1285390,status:'',trainid:''},
      {stop:"Heia",stopid:1285380,status:'',trainid:''},
      {stop:"Eidsberg",stopid:1255370,status:'',trainid:''},
      {stop:"Mysen",stopid:1250100,status:'',trainid:''},
      {stop:"Slitu",stopid:1255340,status:'',trainid:''},
      {stop:"Askim",stopid:1240700,status:'',trainid:''},
      {stop:"Spydeberg",stopid:1230600,status:'',trainid:''},
      {stop:"Knapstad",stopid:1380120,status:'',trainid:''},
      {stop:"Tomter",stopid:1380100,status:'',trainid:''},
      {stop:"Skotbu",stopid:2130600,status:'',trainid:''},
      {stop:"Kråkstad",stopid:2130400,status:'',trainid:''},
      {stop:"Ski",stopid:2130300,status:'',trainid:''},
      {stop:"Holmlia",stopid:3010920,status:'',trainid:''},
      {stop:"Oslo Sentralstasjon",stopid:3010010,status:'',trainid:''},
      {stop:"Nationaltheatret",stopid:3010030,status:'',trainid:''},
      {stop:"Skøyen",stopid:3012500,status:'',trainid:''}      
      ]
    });


    Line.insert({
      'lineNo' : 'L22',
      'destination' :'Rakkestad',
      'trains': [],
      'stops' : [
      {stop:"Skøyen",stopid:3012500,status:'',trainid:''},
      {stop:"Nationaltheatret",stopid:3010030,status:'',trainid:''},
      {stop:"Oslo Sentralstasjon",stopid:3010010,status:'',trainid:''},
      {stop:"Holmlia",stopid:3010920,status:'',trainid:''},
      {stop:"Ski",stopid:2130300,status:'',trainid:''},
      {stop:"Kråkstad",stopid:2130400,status:'',trainid:''},
      {stop:"Skotbu",stopid:2130600,status:'',trainid:''},
      {stop:"Tomter",stopid:1380100,status:'',trainid:''},
      {stop:"Knapstad",stopid:1380120,status:'',trainid:''},
      {stop:"Spydeberg",stopid:1230600,status:'',trainid:''},
      {stop:"Askim",stopid:1240700,status:'',trainid:''},
      {stop:"Slitu",stopid:1255340,status:'',trainid:''},
      {stop:"Mysen",stopid:1250100,status:'',trainid:''},
      {stop:"Eidsberg",stopid:1255370,status:'',trainid:''},
      {stop:"Heia",stopid:1285380,status:'',trainid:''},
      {stop:"Rakkestad",stopid:1285390,status:'',trainid:''}
      ]
    });


});

}
