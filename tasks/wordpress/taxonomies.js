module.exports.init = function( grunt ) {
	"use strict";

	var fs = require( "fs" ),
		path = require( "path" ),
		wordpress = require( "../wordpress" ),
		async = grunt.util.async,
		// support: node <0.8
		existsSync = fs.existsSync || path.existsSync,
		exports = {};

	// Converts a term to a readable name, e.g., { taxonomy: "foo", slug: "bar" } to "foo bar"
	function prettyTermName( term ) {
		return term.taxonomy + " " + term.slug;
	}

	exports.wordpress_validate_terms = function( filepath, fn ) {
		var taxonomies,
			client = wordpress.wordpress_client( grunt ),
			count = 0;

		function complete() {
			var msg = "Validated " + (count === 1 ?
				"one term." :
				(count + " terms."));
			grunt.log.writeln( msg );
			fn( null );
		}

		if ( !existsSync( filepath ) ) {
			return complete();
		}

		// Check if the taxonomies JSON format is valid
		try {
			taxonomies = grunt.file.readJSON( filepath );
		} catch( error ) {
			grunt.log.error( "Invalid taxonomy definitions file." );
			return fn( error );
		}

		async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
			function process( terms, fn ) {
				var termNames = [];
				async.forEachSeries( terms, function( term, fn ) {
					if ( !term.name ) {
						return fn( new Error( "A " + taxonomy + " term has no name." ) );
					}
					if ( termNames.indexOf( term.name ) !== -1 ) {
						return fn( new Error( "There are multiple " + taxonomy + " " + term.name + " terms." ) );
					}
					if ( !term.slug ) {
						return fn( new Error( "The " + taxonomy + " term " + term.name + " has no slug." ) );
					}
					if ( !(/^([a-zA-Z0-9]+[.\-]?)+$/).test( term.slug ) ) {
						return fn( new Error( "Invalid slug: " + term.slug + "." ) );
					}

					termNames.push( term.name );
					count++;
					if ( term.children ) {
						return process( term.children, fn );
					}

					fn( null );
				}, fn );
			}

			process( taxonomies[ taxonomy ], fn );
		}, function( error ) {
			if ( error ) {
				return fn( error );
			}

			complete();
		});
	},

	exports.wordpress_get_terms = function( fn ) {
		var client = wordpress.wordpress_client( grunt );

		async.waterfall([
			function getTaxonomies( fn ) {
				grunt.verbose.write( "Getting taxonomies from WordPress..." );
				client.getTaxonomies( fn );
			},

			function getTerms( taxonomies, fn ) {
				var existingTerms = {};
				grunt.verbose.ok();

				async.forEachSeries( taxonomies, function( taxonomy, fn ) {
					existingTerms[ taxonomy.name ] = {};
					grunt.verbose.write( "Getting " + taxonomy.name + " terms..." );
					client.getTerms( taxonomy.name, function( error, terms ) {
						var idMap = {};

						if ( error ) {
							grunt.verbose.error();
							grunt.verbose.or.error( "Error getting " + taxonomy.name + "." );
							return fn( error );
						}

						grunt.verbose.ok();

						function expandSlug( term ) {
							var slug = term.slug;
							while ( term.parent !== "0" ) {
								term = idMap[ term.parent ];
								slug = term.slug + "/" + slug;
							}
							return slug;
						}
						terms.forEach(function( term ) {
							idMap[ term.termId ] = term;
						});

						terms.forEach(function( term ) {
							existingTerms[ taxonomy.name ][ expandSlug( term ) ] = term;
						});
						fn( null );
					});
				}, function( error ) {
					if ( error ) {
						return fn( error );
					}

					grunt.verbose.writeln();
					fn( null, existingTerms );
				});
			}
		], fn );
	},

	exports.wordpress_publish_term = function( term, fn ) {
		var client = wordpress.wordpress_client( grunt ),
			name = prettyTermName( term );

		if ( term.termId ) {
			grunt.verbose.write( "Editing " + name + "..." );
			client.editTerm( term.termId, term, function( error ) {
				if ( error ) {
					grunt.verbose.error();
					return fn( error );
				}

				grunt.verbose.ok();
				grunt.verbose.or.writeln( "Edited " + name + "." );
				fn( null, term.termId );
			});
		} else {
			grunt.verbose.write( "Creating " + name + "..." );
			client.newTerm( term, function( error, termId ) {
				if ( error ) {
					grunt.verbose.error();
					return fn( error );
				}

				grunt.verbose.ok();
				grunt.verbose.or.writeln( "Created " + name + "." );
				fn( null, termId );
			});
		}
	},

	exports.wordpress_delete_term = function( term, fn ) {
		var client = wordpress.wordpress_client( grunt ),
			name = prettyTermName( term );

		grunt.verbose.write( "Deleting " + name + "..." );
		client.deleteTerm( term.taxonomy, term.termId, function( error ) {
			if ( error ) {
				grunt.verbose.error();
				grunt.verbose.or.error( "Error deleting " + name + "." );
				return fn( error );
			}

			grunt.verbose.ok();
			grunt.verbose.or.writeln( "Deleted " + name + "." );
			fn( null );
		});
	},

	exports.wordpress_sync_terms = function( filepath, fn ) {
		var taxonomies,
			client = wordpress.wordpress_client( grunt );

		grunt.verbose.writeln( "Synchronizing terms.".bold );

		// Check if there are any terms to process
		if ( !existsSync( filepath ) ) {
			grunt.verbose.writeln( "No terms to process." );
			grunt.verbose.writeln();
			return fn( null );
		}

		// Check if the taxonomies JSON format is valid
		try {
			taxonomies = grunt.file.readJSON( filepath );
		} catch( error ) {
			grunt.log.error( "Invalid taxonomy definitions file." );
			return fn( error );
		}

		async.waterfall([
			function getTerms( fn ) {
				exports.wordpress_get_terms( fn );
			},

			function publishTerms( existingTerms, fn ) {
				var termMap = {};

				grunt.verbose.writeln( "Processing terms.".bold );
				async.forEachSeries( Object.keys( taxonomies ), function( taxonomy, fn ) {
					// Taxonomies must already exist in WordPress
					if ( !existingTerms[ taxonomy ] ) {
						grunt.log.error( "Taxonomies must exist in WordPress prior to use in taxonomies.json." );
						return fn( new Error( "Invalid taxonomy: " + taxonomy ) );
					}

					grunt.verbose.writeln( ("Processing " + taxonomy + " terms.").bold );
					termMap[ taxonomy ] = {};

					function process( terms, parent, fn ) {
						async.forEachSeries( terms, function( term, fn ) {
							term.__slug = (parent ? parent.__slug + "/" : "") + term.slug;
							if ( existingTerms[ taxonomy ][ term.__slug ] ) {
								term.termId = existingTerms[ taxonomy ][ term.__slug ].termId;
							}
							// TODO: check if a term with the same name already exists
							term.taxonomy = taxonomy;
							term.parent = parent ? parent.termId : null;

							exports.wordpress_publish_term( term, function( error, termId ) {
								if ( error ) {
									grunt.verbose.or.error( "Error processing " + prettyTermName( term ) + "." );
									return fn( error );
								}

								term.termId = termId;
								termMap[ taxonomy ][ term.__slug ] = termId;
								function done( error ) {
									if ( error ) {
										return fn( error );
									}

									delete existingTerms[ taxonomy ][ term.__slug ];
									fn( null, termId );
								}

								if ( !term.children ) {
									return done();
								}

								// Process child terms
								process( term.children, term, done );
							});
						}, function( error ) {
							fn( error );
						});
					}

					// Process top level terms
					process( taxonomies[ taxonomy ], null, fn );
				}, function( error ) {
					if ( error ) {
						return fn( error );
					}

					grunt.verbose.writeln();
					fn( null, termMap, existingTerms );
				});
			},

			// TODO: Don't delete terms until after processing posts.
			// This will allow us to use keywords without defining all of them upfront.
			function deleteTerms( termMap, existingTerms, fn ) {
				grunt.verbose.writeln( "Deleting old terms.".bold );
				async.map( Object.keys( existingTerms ), function( taxonomy, fn ) {
					var terms = existingTerms[ taxonomy ];
					async.forEachSeries( Object.keys( terms ), function( term, fn ) {
						exports.wordpress_delete_term( terms[ term ], fn );
					}, fn );
				}, function( error ) {
					if ( error ) {
						return fn( error );
					}

					grunt.verbose.writeln();
					fn( null, termMap );
				});
			}
		], fn );
	};

	return exports;
};
